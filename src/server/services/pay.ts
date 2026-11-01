import { plannedJobs, remindersOf, type PlannedReminders } from '@/server/domain/bookingPlan';
import { localDayOf } from '@/server/domain/dateRange';
import { holdIsLive } from '@/server/domain/deposit';
import { verifyToken } from '@/server/domain/tokens';
import { requireLinkSecret } from '@/server/env';
import { AppError, safeError } from '@/server/http/errors';
import type { Logger } from '@/server/http/logger';
import { getPaymentProvider, type PaymentProvider } from '@/server/providers/payment';
import { appointmentRepo } from '@/server/repositories/appointment.repo';
import { publicBusinessRepo } from '@/server/repositories/publicBusiness.repo';
import { reminderJobRepo } from '@/server/repositories/reminderJob.repo';
import { computeAvailability, toPublicSlots, type PublicSlot } from './availability';
import { defaultWaitlistDeps, expireLapsedHolds, type WaitlistDeps } from './waitlist';

export interface PayCtx {
  requestId: string;
  logger: Logger;
}

export interface PayDeps {
  now: () => Date;
  linkSecret: () => string;
  payments: () => PaymentProvider;
  /** Used to free an expired hold at once (and offer the slot). */
  waitlist: WaitlistDeps;
}

export const defaultPayDeps: PayDeps = {
  now: () => new Date(),
  linkSecret: () => requireLinkSecret(),
  payments: getPaymentProvider,
  waitlist: defaultWaitlistDeps,
};

type Row = NonNullable<Awaited<ReturnType<typeof appointmentRepo.findForPay>>>;

/** Statuses that mean "the deposit was paid and the booking went on". */
const PAID_ON = ['BOOKED', 'CONFIRMED', 'ATTENDED', 'NO_SHOW'];

interface Resolved {
  businessId: string;
  appointmentId: string;
  /** True when only the signature was valid: the token's own expiry has passed. */
  tokenExpired: boolean;
}

/**
 * Pay tokens are scoped `pay` (a confirm/cancel/claim token is NOT accepted here, and a pay token is not
 * accepted anywhere else). Bad signature, malformed, wrong scope or unknown appointment -> 404. An expired
 * but genuine token is still resolved, only to answer a friendly "this hold expired" with fresh slots.
 */
async function resolve(token: string, deps: PayDeps): Promise<Resolved> {
  const secret = deps.linkSecret();
  const live = verifyToken(token, secret, deps.now(), 'pay');
  let appointmentId: string | undefined;
  let tokenExpired = false;
  if (live.ok) appointmentId = live.payload.a;
  else if (live.reason === 'expired') {
    // Signature and scope check with the expiry ignored (epoch 0 is before any exp).
    const peek = verifyToken(token, secret, new Date(0), 'pay');
    if (peek.ok) {
      appointmentId = peek.payload.a;
      tokenExpired = true;
    }
  }
  if (!appointmentId) throw AppError.notFound();
  const businessId = await appointmentRepo.businessIdOf(appointmentId);
  if (!businessId) throw AppError.notFound();
  return { businessId, appointmentId, tokenExpired };
}

async function load(r: Resolved): Promise<Row> {
  const row = await appointmentRepo.findForPay(r.businessId, r.appointmentId);
  if (!row) throw AppError.notFound();
  return row;
}

function view(
  row: Row,
  now: Date,
  state: 'PENDING' | 'PAID',
  testMode: boolean,
  reminders: PlannedReminders,
) {
  const deposit = row.payments[0];
  return {
    state,
    appointment: {
      id: row.id,
      startAt: row.startAt,
      endAt: row.endAt,
      status: row.status,
      service: row.service,
      staff: row.staff,
    },
    business: row.business,
    deposit: {
      amount: deposit ? Number(deposit.amount.toString()) : 0,
      currency: deposit?.currency ?? 'USD',
    },
    holdExpiresAt: row.holdExpiresAt,
    /** The server's clock, so the page's countdown does not trust the phone's. */
    now,
    testMode,
    /** Post-payment truth: the rows created when it was paid (none while it is still a hold). */
    reminders,
  };
}

/**
 * A paid booking's reminders were planned at payment time (not at booking time), so the confirmed screen
 * reads the stored rows. A pending hold has none yet.
 */
async function viewOf(
  r: Resolved,
  row: Row,
  now: Date,
  state: 'PENDING' | 'PAID',
  testMode: boolean,
) {
  const reminders =
    state === 'PAID'
      ? remindersOf(await reminderJobRepo.emailReminderKinds(r.businessId, row.id))
      : { h24: false, h2: false };
  return view(row, now, state, testMode, reminders);
}

/** Fresh bookable slots for the same service on the appointment's day. Empty when none can be loaded. */
async function freshSlots(row: Row, businessId: string, now: Date): Promise<PublicSlot[]> {
  try {
    const business = await publicBusinessRepo.findById(businessId);
    if (!business) return [];
    const day = localDayOf(row.startAt, business.timezone);
    const avail = await computeAvailability(
      business,
      {
        serviceId: row.serviceId,
        staffId: undefined,
        from: day.date,
        to: day.date,
        startUtc: day.startUtc,
        endUtc: day.endUtc,
      },
      now,
    );
    return avail ? toPublicSlots(avail, undefined) : [];
  } catch {
    return [];
  }
}

/** 410 for a hold that can no longer be paid: HOLD_EXPIRED (it lapsed) or BOOKING_CANCELLED (someone cancelled it). */
async function expired(row: Row, businessId: string, now: Date): Promise<AppError> {
  const lapsed =
    row.status === 'PENDING_PAYMENT' ||
    (row.status === 'CANCELLED' && row.cancelledVia === 'SYSTEM');
  const data = {
    slug: row.business.slug,
    serviceId: row.serviceId,
    slots: await freshSlots(row, businessId, now),
  };
  return lapsed
    ? new AppError(
        410,
        'HOLD_EXPIRED',
        'This booking was not paid in time and the slot was released.',
        {},
        data,
      )
    : new AppError(
        410,
        'BOOKING_CANCELLED',
        'This booking was cancelled, so there is nothing to pay.',
        {},
        data,
      );
}

export const payService = {
  /** No side effects: scanners and previews open links. */
  async get(ctx: PayCtx, token: string, deps: PayDeps = defaultPayDeps) {
    const r = await resolve(token, deps);
    const now = deps.now();
    const row = await load(r);
    const provider = deps.payments();
    if (PAID_ON.includes(row.status) && row.payments[0]?.status === 'PAID')
      return await viewOf(r, row, now, 'PAID', provider.testMode);
    if (row.status === 'PENDING_PAYMENT' && !r.tokenExpired && holdIsLive(row.holdExpiresAt, now))
      return await viewOf(r, row, now, 'PENDING', provider.testMode);
    throw await expired(row, r.businessId, now);
  },

  /**
   * Complete the deposit. The ONLY thing that flips the appointment is the provider's answer
   * (getStatus === PAID); the request body carries nothing. Idempotent: a repeat finds BOOKED (paid) and
   * changes nothing (no second set of reminder jobs).
   */
  async pay(ctx: PayCtx, token: string, deps: PayDeps = defaultPayDeps) {
    const r = await resolve(token, deps);
    const now = deps.now();
    const provider = deps.payments();
    const logger = ctx.logger.child({ businessId: r.businessId, appointmentId: r.appointmentId });
    let row = await load(r);

    if (PAID_ON.includes(row.status) && row.payments[0]?.status === 'PAID')
      return await viewOf(r, row, now, 'PAID', provider.testMode);

    const lapsed = async () => {
      // Free the slot right away instead of waiting for the next cron run.
      try {
        await expireLapsedHolds(logger, deps.waitlist);
      } catch (error) {
        logger.error({ err: safeError(error) }, 'expiring lapsed holds from the pay page failed');
      }
      return expired(row, r.businessId, now);
    };

    if (row.status !== 'PENDING_PAYMENT') throw await expired(row, r.businessId, now);
    if (r.tokenExpired || !holdIsLive(row.holdExpiresAt, now)) throw await lapsed();

    const payment = row.payments[0];
    if (!payment) throw AppError.notFound();
    const status = await provider.getStatus(payment.externalId);
    logger.info(
      { requestId: ctx.requestId, paymentId: payment.id, providerStatus: status },
      'deposit provider status',
    );
    if (status !== 'PAID')
      throw AppError.conflict(
        'PAYMENT_NOT_COMPLETED',
        undefined,
        'The test payment did not complete.',
      );

    const flipped = await appointmentRepo.confirmPaid(
      r.businessId,
      r.appointmentId,
      now,
      plannedJobs(row.startAt, now),
    );
    row = await load(r);
    if (flipped) {
      logger.info({ requestId: ctx.requestId, paymentId: payment.id }, 'deposit paid, booking confirmed');
      return await viewOf(r, row, now, 'PAID', provider.testMode);
    }
    // Lost the race: whoever won decides what we answer.
    if (PAID_ON.includes(row.status) && row.payments[0]?.status === 'PAID')
      return await viewOf(r, row, now, 'PAID', provider.testMode);
    throw await expired(row, r.businessId, now);
  },
};
