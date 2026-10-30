import { plannedJobs, sameBookingRequest } from '@/server/domain/bookingPlan';
import { localDayOf } from '@/server/domain/dateRange';
import { normalizePhone } from '@/server/domain/phone';
import { pickStaff } from '@/server/domain/slots';
import { depositRequired, holdExpiresAtFor } from '@/server/domain/deposit';
import { expiryFor, payExpiryFor, signToken } from '@/server/domain/tokens';
import { getServerEnv, misconfiguredError, requireLinkSecret } from '@/server/env';
import { AppError, pgErrorCode } from '@/server/http/errors';
import type { Logger } from '@/server/http/logger';
import { getPaymentProvider, type PaymentProvider } from '@/server/providers/payment';
import { appointmentRepo, type NewDeposit } from '@/server/repositories/appointment.repo';
import { availabilityRepo } from '@/server/repositories/availability.repo';
import { clientRepo } from '@/server/repositories/client.repo';
import { publicBusinessRepo } from '@/server/repositories/publicBusiness.repo';
import { computeAvailability, toPublicSlots, type PublicSlot } from './availability';

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
    startAt: Date;
    endAt: Date;
    status: string;
    service: { id: string; name: string; durationMin: number; price: number };
    staff: { id: string; displayName: string };
  };
  links: { manage: string };
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

function result(a: Stored, replay: boolean, cfg: LinkConfig): BookingResult {
  const base = { replay, appointment: appointmentSummary(a), links: { manage: manageLink(a, cfg) } };
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

/**
 * Does this booking need a deposit? If so, open the (fake, test-mode) checkout and return what the insert
 * stores. Front-desk bookings never reach the provider. The checkout key derives from the booking's
 * Idempotency-Key so a retried request opens the same checkout.
 */
async function depositFor(
  businessId: string,
  phone: string,
  input: BookInput,
  now: Date,
  deps: BookDeps,
): Promise<NewDeposit | undefined> {
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
  const session = await provider.createCheckout({
    businessId,
    purpose: 'DEPOSIT',
    amount: settings.amount,
    currency: settings.currency,
    idempotencyKey: input.idempotencyKey ? `deposit:${input.idempotencyKey}` : undefined,
  });
  return {
    holdExpiresAt: holdExpiresAtFor(now),
    payment: {
      provider: provider.name,
      externalId: session.externalId,
      amount: settings.amount,
      currency: settings.currency,
    },
  };
}

/**
 * THE booking path: public bookings, front-desk bookings and (later) waitlist claims and deposits all
 * insert through here. The friendly availability re-check is advisory; the appointment_no_overlap
 * constraint (23P01) is the only referee.
 */
export async function book(
  ctx: BookingCtx,
  input: BookInput,
  deps: BookDeps = defaultBookDeps,
): Promise<BookingResult> {
  const { businessId } = ctx;
  // Everything the response needs is resolved BEFORE any write: a misconfiguration must never surface
  // after the booking has committed (the customer would see a 500 for a booking that exists).
  const cfg: LinkConfig = { secret: deps.linkSecret(), appUrl: deps.appUrl() };
  if (cfg.secret.length < 32 || !/^https?:\/\//.test(cfg.appUrl)) throw misconfiguredError();
  const phone = normalizePhone(input.client.phone);
  if (!phone) throw AppError.validation({ 'client.phone': 'Enter a valid phone number.' });
  const now = deps.now();
  const specific = input.staffId !== 'anyone' ? input.staffId : undefined;
  const key = input.idempotencyKey;

  const replayOf = (stored: Stored): BookingResult => {
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
    return result(stored, true, cfg);
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
  const deposit = await depositFor(businessId, phone, input, now, deps);
  const reminders = deposit ? [] : plannedJobs(input.startAt, now);
  await deps.afterAvailability?.({ candidates: [...remaining] });

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
        // Only an authenticated front-desk booking may change an existing client's contact details.
        overwriteContact: input.source === 'FRONT_DESK',
        reminders,
        deposit,
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
      return result(stored, false, cfg);
    } catch (error) {
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
      remaining = remaining.filter((id) => id !== pick);
    }
  }
  throw slotTaken(await freshSlots());
}
