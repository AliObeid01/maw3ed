import {
  plannedJobs,
  sameBookingRequest,
  type PlannedReminders,
} from '@/server/domain/bookingPlan';
import { normaliseContactEmail } from '@/server/domain/contactEmail';
import { localDayOf } from '@/server/domain/dateRange';
import { normalizePhone } from '@/server/domain/phone';
import { pickStaff } from '@/server/domain/slots';
import { depositRequired, holdExpiresAtFor } from '@/server/domain/deposit';
import { expiryFor, payExpiryFor, signToken } from '@/server/domain/tokens';
import { getServerEnv, misconfiguredError, requireLinkSecret } from '@/server/env';
import { AppError, pgErrorCode } from '@/server/http/errors';
import type { Logger } from '@/server/http/logger';
import { getPaymentProvider, type PaymentProvider } from '@/server/providers/payment';
import {
  appointmentRepo,
  type ExpiredHold,
  type NewDeposit,
} from '@/server/repositories/appointment.repo';
import { availabilityRepo } from '@/server/repositories/availability.repo';
import { clientRepo } from '@/server/repositories/client.repo';
import { storedReminders } from './reminderPromise';
import { publicBusinessRepo } from '@/server/repositories/publicBusiness.repo';
import { computeAvailability, toPublicSlots, type PublicSlot } from './availability';
import { onSlotFreed } from './slotFreed';

export interface BookingCtx {
  businessId: string;
  requestId: string;
  logger: Logger;
}

export interface BookInput {
  serviceId: string;
  /** A staff id, or 'anyone'. */
  staffId: string;
  startAt: Date;
  client: { name: string; phone: string; email?: string | undefined };
  source: 'PUBLIC' | 'FRONT_DESK' | 'WAITLIST';
  idempotencyKey?: string | undefined;
  /**
   * F16: where THIS booking's emails go, when it differs from `client.email` (a waitlist claim: the entry's
   * own contact address). Default: the email typed with the booking. Stored on the appointment only.
   */
  contactEmail?: string | undefined;
  /**
   * Front-desk walk-ins: skip the business's minimum notice. The booking window, working hours, time off
   * and the exclusion constraint still apply. Only the session-authenticated front-desk path sets this.
   */
  ignoreMinNotice?: boolean;
}

export interface BookDeps {
  now: () => Date;
  linkSecret: () => string;
  appUrl: () => string;
  /** The payment provider for deposit holds (default: the configured one, the fake in test mode). */
  payments?: () => PaymentProvider;
  /** Test seam: the booking reference source (default: crypto.randomInt over the unambiguous alphabet). */
  newReference?: () => string;
  /** Test seam: runs after the availability read and before the insert (to provoke a lost race). */
  afterAvailability?: (info: { candidates: string[] }) => Promise<void>;
}

export const defaultBookDeps: BookDeps = {
  now: () => new Date(),
  linkSecret: () => requireLinkSecret(),
  appUrl: () => getServerEnv().APP_URL,
};

type Stored = NonNullable<Awaited<ReturnType<typeof appointmentRepo.findById>>>;

export interface BookingResult {
  /** True when an Idempotency-Key matched an earlier booking (HTTP 200 instead of 201). */
  replay: boolean;
  appointment: {
    id: string;
    /** Short code for the client to quote. A label only: never a credential. Null on rows before PR-6. */
    reference: string | null;
    startAt: Date;
    endAt: Date;
    status: string;
    service: { id: string; name: string; durationMin: number; price: number };
    staff: { id: string; displayName: string };
  };
  links: { manage: string };
  /**
   * The email reminders this booking has. Taken from the same plan that creates the ReminderJob rows (a
   * replay reads the stored rows), so a page can only promise what will exist. A deposit hold has none until
   * it is paid: the pay response then carries the post-payment truth.
   */
  reminders: PlannedReminders;
  /**
   * Present ONLY when the booking needs a deposit first: the appointment holds its slot as
   * PENDING_PAYMENT until `holdExpiresAt`, with no reminders and no confirmation email until it is paid.
   */
  status?: 'PENDING_PAYMENT';
  payUrl?: string;
  payToken?: string;
  holdExpiresAt?: Date;
}

const price = (v: { toString(): string }) => Number(v.toString());

export function appointmentSummary(a: Stored) {
  return {
    id: a.id,
    reference: a.reference,
    startAt: a.startAt,
    endAt: a.endAt,
    status: a.status,
    service: {
      id: a.service.id,
      name: a.service.name,
      durationMin: a.service.durationMin,
      price: price(a.service.price),
    },
    staff: a.staff,
  };
}

interface LinkConfig {
  secret: string;
  appUrl: string;
}

function manageLink(a: Stored, cfg: LinkConfig): string {
  const token = signToken({ a: a.id, act: 'view', exp: expiryFor(a.startAt) }, cfg.secret);
  return `${cfg.appUrl.replace(/\/+$/, '')}/l/${token}`;
}

function result(
  a: Stored,
  replay: boolean,
  cfg: LinkConfig,
  reminders: PlannedReminders,
): BookingResult {
  const base = {
    replay,
    appointment: appointmentSummary(a),
    links: { manage: manageLink(a, cfg) },
    reminders,
  };
  if (a.status !== 'PENDING_PAYMENT' || !a.holdExpiresAt) return base;
  const payToken = signToken(
    { a: a.id, act: 'pay', exp: payExpiryFor(a.holdExpiresAt) },
    cfg.secret,
  );
  return {
    ...base,
    status: 'PENDING_PAYMENT',
    payToken,
    payUrl: `${cfg.appUrl.replace(/\/+$/, '')}/pay/${payToken}`,
    holdExpiresAt: a.holdExpiresAt,
  };
}

const slotTaken = (slots: PublicSlot[]) =>
  AppError.conflict('SLOT_TAKEN', { slots }, 'That time is no longer available. Pick another.');

interface DepositPlan {
  deposit: NewDeposit;
  provider: PaymentProvider;
  amount: number;
  currency: string;
}

/**
 * Does this booking need a deposit? Decides only: nothing is opened at the provider yet (that happens AFTER
 * the insert wins the slot, so a lost race leaves no orphan checkout). Front-desk bookings never need one.
 */
async function depositFor(
  businessId: string,
  phone: string,
  input: BookInput,
  now: Date,
  deps: BookDeps,
): Promise<DepositPlan | undefined> {
  if (input.source === 'FRONT_DESK') return undefined;
  const settings = await publicBusinessRepo.depositSettings(businessId);
  if (!settings?.enabled) return undefined;
  const noShows = await clientRepo.noShowsByPhone(businessId, phone);
  if (
    !depositRequired({
      enabled: settings.enabled,
      threshold: settings.threshold,
      noShows,
      source: input.source,
    })
  )
    return undefined;
  const provider = (deps.payments ?? getPaymentProvider)();
  return {
    provider,
    amount: settings.amount,
    currency: settings.currency,
    deposit: {
      holdExpiresAt: holdExpiresAtFor(now),
      payment: { provider: provider.name, amount: settings.amount, currency: settings.currency },
    },
  };
}

/** Open the checkout for a hold that now owns its slot. A provider failure releases the hold. */
async function openCheckout(
  ctx: BookingCtx,
  plan: DepositPlan,
  stored: Stored,
  key: string | undefined,
  now: Date,
): Promise<void> {
  try {
    const session = await plan.provider.createCheckout({
      businessId: ctx.businessId,
      purpose: 'DEPOSIT',
      amount: plan.amount,
      currency: plan.currency,
      appointmentId: stored.id,
      idempotencyKey: key ? `deposit:${key}` : undefined,
    });
    await appointmentRepo.setCheckoutId(ctx.businessId, stored.id, session.externalId);
  } catch {
    ctx.logger.error(
      { businessId: ctx.businessId, appointmentId: stored.id },
      'deposit checkout failed; releasing the hold',
    );
    try {
      if (await appointmentRepo.abandonHold(ctx.businessId, stored.id, now))
        await onSlotFreed(
          { businessId: ctx.businessId, logger: ctx.logger },
          {
            appointmentId: stored.id,
            serviceId: stored.service.id,
            staffId: stored.staff.id,
            startAt: stored.startAt,
            endAt: stored.endAt,
          },
        );
    } catch {
      // The caller still gets the 503; the cron sweeps the hold when it lapses.
      ctx.logger.error(
        { businessId: ctx.businessId, appointmentId: stored.id },
        'releasing the hold after a failed checkout also failed',
      );
    }
    throw AppError.unavailable('Payments are temporarily unavailable. Please try again.');
  }
}

/**
 * THE booking path: public bookings, front-desk bookings, waitlist claims and deposit holds all insert
 * through here. The friendly availability re-check is advisory; the appointment_no_overlap constraint
 * (23P01) is the only referee. Lapsed deposit holds in the way are swept first (scoped to this business and
 * day); the waitlist cascade for those freed slots runs afterwards, exactly like the cron's.
 */
export async function book(
  ctx: BookingCtx,
  input: BookInput,
  deps: BookDeps = defaultBookDeps,
): Promise<BookingResult> {
  const swept: ExpiredHold[] = [];
  try {
    return await bookInner(ctx, input, deps, swept);
  } finally {
    for (const hold of swept)
      await onSlotFreed(
        { businessId: hold.businessId, logger: ctx.logger },
        {
          appointmentId: hold.id,
          serviceId: hold.serviceId,
          staffId: hold.staffId,
          startAt: hold.startAt,
          endAt: hold.endAt,
        },
      );
  }
}

async function bookInner(
  ctx: BookingCtx,
  input: BookInput,
  deps: BookDeps,
  swept: ExpiredHold[],
): Promise<BookingResult> {
  const { businessId } = ctx;
  // Everything the response needs is resolved BEFORE any write: a misconfiguration must never surface
  // after the booking has committed (the customer would see a 500 for a booking that exists).
  const cfg: LinkConfig = { secret: deps.linkSecret(), appUrl: deps.appUrl() };
  if (cfg.secret.length < 32 || !/^https?:\/\//.test(cfg.appUrl)) throw misconfiguredError();
  const phone = normalizePhone(input.client.phone);
  if (!phone) throw AppError.validation({ 'client.phone': 'Enter a valid phone number.' });
  const contactEmail = normaliseContactEmail(input.contactEmail ?? input.client.email);
  const now = deps.now();
  const specific = input.staffId !== 'anyone' ? input.staffId : undefined;
  const key = input.idempotencyKey;

  const replayOf = async (stored: Stored): Promise<BookingResult> => {
    const same = sameBookingRequest(
      {
        serviceId: stored.service.id,
        staffId: stored.staff.id,
        startAt: stored.startAt,
        phone: stored.client.phone,
      },
      { serviceId: input.serviceId, staffId: input.staffId, startAt: input.startAt, phone },
    );
    if (!same)
      throw new AppError(
        422,
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used for a different booking.',
      );
    ctx.logger.info({ businessId, appointmentId: stored.id }, 'booking replayed (idempotent)');
    // What the first booking really got, from the stored rows.
    return result(stored, true, cfg, await storedReminders(businessId, stored.id));
  };

  if (key) {
    const existing = await appointmentRepo.findByIdempotencyKey(businessId, key);
    if (existing) return replayOf(existing);
  }

  const loaded = await publicBusinessRepo.findById(businessId);
  if (!loaded) throw AppError.notFound();
  // Walk-ins: slot generation itself is untouched; only this call gets minNoticeMin = 0.
  const business = input.ignoreMinNotice ? { ...loaded, minNoticeMin: 0 } : loaded;
  const day = localDayOf(input.startAt, business.timezone);
  const query = {
    serviceId: input.serviceId,
    staffId: specific,
    from: day.date,
    to: day.date,
    startUtc: day.startUtc,
    endUtc: day.endUtc,
  };

  // A deposit hold that lapsed but was not swept by the cron yet must not block this slot.
  const sweep = async () => {
    const rows = await appointmentRepo.expireHoldsFor(
      businessId,
      { staffId: specific, from: day.startUtc, to: day.endUtc },
      deps.now(),
    );
    swept.push(...rows);
    return rows.length;
  };
  await sweep();

  const avail = await computeAvailability(business, query, now);
  if (!avail) throw AppError.notFound('Service not found.');
  if (specific && avail.staff.length === 0) {
    if (await availabilityRepo.staffExists(businessId, specific))
      throw AppError.validation({ staffId: 'This person does not offer that service.' });
    throw AppError.notFound('Staff member not found.');
  }

  const freshSlots = async (): Promise<PublicSlot[]> => {
    const fresh = await computeAvailability(business, query, deps.now());
    return fresh ? toPublicSlots(fresh, specific) : [];
  };

  // Friendly re-check (also enforces minNotice, bookingWindow, step alignment and working hours).
  const startMs = input.startAt.getTime();
  let remaining = avail.slots.filter((s) => s.startAt.getTime() === startMs).map((s) => s.staffId);
  if (remaining.length === 0) throw slotTaken(await freshSlots());

  const counts = specific
    ? {}
    : await appointmentRepo.countByStaff(businessId, remaining, day.startUtc, day.endUtc);
  const slot = avail.slots.find((s) => s.startAt.getTime() === startMs)!;
  // Deposit (FR-26): decided from the client's no-show counter. The booking still goes through the SAME
  // insert below; only its status (PENDING_PAYMENT), reminders (none yet) and a Payment row differ.
  const plan = await depositFor(businessId, phone, input, now, deps);
  const deposit = plan?.deposit;
  // F68: a PUBLIC booking under 2 h ahead also gets one WhatsApp LATE row (front desk and waitlist claims none).
  const reminders = deposit ? [] : plannedJobs(input.startAt, now, { source: input.source });
  await deps.afterAvailability?.({ candidates: [...remaining] });

  let sweptAgain = false;
  while (remaining.length > 0) {
    const pick = specific ?? pickStaff(remaining, counts)!;
    try {
      const stored = await appointmentRepo.create(businessId, {
        serviceId: input.serviceId,
        staffId: pick,
        startAt: slot.startAt,
        endAt: slot.endAt,
        blockedUntil: slot.blockedUntil,
        source: input.source,
        idempotencyKey: key,
        client: { name: input.client.name, phone, email: input.client.email },
        // F16: the address for THIS booking. The client record keeps its own fill-only-if-empty rule.
        contactEmail,
        // The name typed for THIS booking (not for a waitlist claim: there the name is the record's, and
        // mail to the entry's address is greeted by `mailGreetingName`).
        contactName:
          input.source === 'WAITLIST' ? undefined : input.client.name.trim() || undefined,
        // Only an authenticated front-desk booking may change an existing client's contact details.
        overwriteContact: input.source === 'FRONT_DESK',
        reminders,
        deposit,
        newReference: deps.newReference,
      });
      ctx.logger.info(
        {
          businessId,
          appointmentId: stored.id,
          staffId: pick,
          source: input.source,
          depositHold: deposit !== undefined,
        },
        deposit ? 'appointment held pending deposit' : 'appointment booked',
      );
      if (plan) await openCheckout(ctx, plan, stored, key, deps.now());
      // Read back from the rows just inserted with the appointment.
      return result(stored, false, cfg, await storedReminders(businessId, stored.id));
    } catch (error) {
      if (error instanceof AppError) throw error;
      const pg = pgErrorCode(error);
      const code = (error as { code?: unknown } | null)?.code;
      const unique = pg === '23505' || code === 'P2002';
      if (pg !== '23P01' && !unique) throw error;
      // Under a race, the idempotency unique key or the slot constraint may fire first for a duplicate
      // request: either way the first booking with this key wins.
      if (key) {
        const first = await appointmentRepo.findByIdempotencyKey(businessId, key);
        if (first) return replayOf(first);
      }
      if (unique) throw error;
      ctx.logger.info({ businessId, staffId: pick }, 'slot taken at insert (23P01)');
      // The blocker may be a hold that lapsed since the sweep: sweep once more and retry the same pick once.
      if (!sweptAgain) {
        sweptAgain = true;
        if ((await sweep()) > 0) continue;
      }
      remaining = remaining.filter((id) => id !== pick);
    }
  }
  throw slotTaken(await freshSlots());
}
