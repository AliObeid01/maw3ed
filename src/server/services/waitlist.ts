import { DateTime } from 'luxon';
import { ACTIVE_APPOINTMENT_STATUSES } from '@/server/domain/appointmentStatus';
import { MAX_SLOT_RANGE_DAYS, resolveLocalRange } from '@/server/domain/dateRange';
import { normalizePhone } from '@/server/domain/phone';
import { offerExpiryFor as tokenExpiryFor, signToken } from '@/server/domain/tokens';
import { summarizeActivity } from '@/server/domain/waitlistActivity';
import { matchEntries, offerExpiryFor, OFFER_BATCH_SIZE } from '@/server/domain/waitlistMatch';
import { getServerEnv, misconfiguredError, requireLinkSecret } from '@/server/env';
import { AppError, safeError } from '@/server/http/errors';
import type { Logger } from '@/server/http/logger';
import type { RouteContext, SessionContext } from '@/server/http/withRoute';
import { renderOfferEmail } from '@/server/i18n/offerEmail';
import {
  EmailSendError,
  getEmailProvider,
  IDEMPOTENT_MISMATCH,
  type EmailProvider,
} from '@/server/providers/email';
import { publicBusinessRepo } from '@/server/repositories/publicBusiness.repo';
import {
  toLocalDate,
  waitlistRepo,
  type EntryRow,
  type OfferRow,
} from '@/server/repositories/waitlist.repo';
import { book, type BookDeps, type BookingResult } from './booking';

export const MAX_OPEN_ENTRIES_PER_CLIENT = 5;

export interface WaitlistDeps {
  now: () => Date;
  provider: () => EmailProvider;
  linkSecret: () => string;
  appUrl: () => string;
  /** Test seam passed to `book()` (provokes a lost race on a claim). */
  afterAvailability?: BookDeps['afterAvailability'];
  /** Monotonic ms clock and wall-clock budget for the expiry run (default performance.now, 45 s). */
  monotonic?: () => number;
  budgetMs?: number;
}

export const defaultWaitlistDeps: WaitlistDeps = {
  now: () => new Date(),
  provider: () => getEmailProvider(),
  linkSecret: () => requireLinkSecret(),
  appUrl: () => getServerEnv().APP_URL,
};

const bookDepsOf = (deps: WaitlistDeps): BookDeps => ({
  now: deps.now,
  linkSecret: deps.linkSecret,
  appUrl: deps.appUrl,
  ...(deps.afterAvailability ? { afterAvailability: deps.afterAvailability } : {}),
});

/** The provider idempotency key and the booking idempotency key are both derived from the offer id. */
export const offerEmailKey = (offerId: string) => `waitlist-offer-${offerId}`;
export const offerBookingKey = (offerId: string) => `waitlist-offer-${offerId}`;

const IS_ACTIVE = (status: string) =>
  (ACTIVE_APPOINTMENT_STATUSES as readonly string[]).includes(status);

// ---- join ----------------------------------------------------------------------------------------

export interface JoinBody {
  serviceId: string;
  staffId: string | null;
  fromDate: string;
  toDate: string;
  client: { name: string; phone: string; email: string };
}

const entryDto = (e: EntryRow) => ({
  id: e.id,
  status: e.status,
  serviceId: e.serviceId,
  staffId: e.staffId,
  fromDate: toLocalDate(e.fromDate),
  toDate: toLocalDate(e.toDate),
});

export async function joinWaitlist(
  ctx: RouteContext,
  slug: string,
  body: JoinBody,
  now: () => Date = () => new Date(),
) {
  const business = await publicBusinessRepo.findBySlug(slug);
  if (!business) throw AppError.notFound();
  const logger = ctx.logger.child({ businessId: business.id });
  const at = now();

  const phone = normalizePhone(body.client.phone);
  if (!phone) throw AppError.validation({ 'client.phone': 'Enter a valid phone number.' });

  const range = resolveLocalRange({
    from: body.fromDate,
    to: body.toDate,
    timezone: business.timezone,
    maxDays: MAX_SLOT_RANGE_DAYS,
    now: at,
    bookingWindowDays: business.bookingWindowDays,
  });
  if (!range.ok)
    throw AppError.validation(
      Object.fromEntries(
        Object.entries(range.fields).map(([k, v]) => [k === 'from' ? 'fromDate' : 'toDate', v]),
      ),
    );
  const today = DateTime.fromMillis(at.getTime(), { zone: business.timezone }).toISODate()!;
  if (body.fromDate < today) throw AppError.validation({ fromDate: 'Pick today or a later date.' });

  if (!(await waitlistRepo.serviceIsActive(business.id, body.serviceId)))
    throw AppError.notFound('Service not found.');
  if (body.staffId) {
    const staff = await waitlistRepo.staffFor(business.id, body.staffId, body.serviceId);
    if (staff === 'missing') throw AppError.notFound('Staff member not found.');
    if (staff === 'no_service')
      throw AppError.validation({ staffId: 'This person does not offer that service.' });
  }

  const result = await waitlistRepo.join(
    business.id,
    { ...body, client: { ...body.client, phone } },
    MAX_OPEN_ENTRIES_PER_CLIENT,
  );
  if (result.kind === 'limit')
    throw AppError.conflict(
      'WAITLIST_LIMIT',
      undefined,
      `You can wait for at most ${MAX_OPEN_ENTRIES_PER_CLIENT} things at once.`,
    );
  logger.info(
    { businessId: business.id, entryId: result.entry.id, kind: result.kind },
    'waitlist join',
  );
  return { existing: result.kind === 'existing', entry: entryDto(result.entry) };
}

// ---- offers: creation and delivery ---------------------------------------------------------------

/** A failed bookkeeping write must not look like a failed send: the resend sweep is idempotent anyway. */
async function recordEmailed(offer: OfferRow, deps: WaitlistDeps, logger: Logger) {
  try {
    await waitlistRepo.markEmailed(offer.businessId, offer.id, deps.now());
  } catch (error) {
    logger.error(
      { offerId: offer.id, err: safeError(error) },
      'waitlist offer emailedAt not saved',
    );
  }
}

/** Send one offer email. Never throws: a failed send is logged and the offer simply lapses unclaimed. */
async function deliverOffer(
  offer: OfferRow,
  deps: WaitlistDeps,
  cfg: { secret: string; appUrl: string; provider: EmailProvider },
  logger: Logger,
): Promise<boolean> {
  // Offers go ONLY to the address supplied with the entry, never to the client record (see join).
  const email = offer.entry.contactEmail;
  const ctxLog = { offerId: offer.id, businessId: offer.businessId, batch: offer.batch };
  if (!email) {
    logger.warn(ctxLog, 'waitlist offer not emailed: entry has no contact email');
    return false;
  }
  const token = signToken(
    { o: offer.id, act: 'claim', exp: tokenExpiryFor(offer.expiresAt) },
    cfg.secret,
  );
  const rendered = renderOfferEmail({
    locale: offer.business.locale,
    timezone: offer.business.timezone,
    businessName: offer.business.name,
    clientName: offer.entry.client.name,
    serviceName: offer.entry.service.name,
    staffName: offer.staff.displayName,
    startAt: offer.startAt,
    expiresAt: offer.expiresAt,
    claimUrl: `${cfg.appUrl}/o/${token}`,
  });
  try {
    const sent = await cfg.provider.send({
      to: email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      idempotencyKey: offerEmailKey(offer.id),
    });
    logger.info({ ...ctxLog, providerMessageId: sent.providerMessageId }, 'waitlist offer sent');
    await recordEmailed(offer, deps, logger);
    return true;
  } catch (error) {
    const code = error instanceof EmailSendError ? error.code : 'send_error';
    if (code === IDEMPOTENT_MISMATCH) {
      logger.warn({ ...ctxLog, code }, 'provider already accepted this offer key');
      await recordEmailed(offer, deps, logger);
      return true;
    }
    logger.error({ ...ctxLog, code }, 'waitlist offer email failed');
    return false;
  }
}

function emailConfig(deps: WaitlistDeps) {
  const secret = deps.linkSecret();
  const appUrl = deps.appUrl().replace(/\/+$/, '');
  if (secret.length < 32 || !/^https?:\/\//.test(appUrl)) throw misconfiguredError();
  return { secret, appUrl, provider: deps.provider() };
}

/** Email these offers (idempotent per offer: the key is derived from the offer id). */
export async function deliverOffers(
  offers: OfferRow[],
  deps: WaitlistDeps,
  logger: Logger,
): Promise<number> {
  if (offers.length === 0) return 0;
  const cfg = emailConfig(deps);
  const results = await Promise.all(offers.map((o) => deliverOffer(o, deps, cfg, logger)));
  return results.filter(Boolean).length;
}

/**
 * Offer one freed slot to the next batch of matching entries (batch = highest used + 1). Returns how
 * many NEW offers this call created; a concurrent call racing for the same entries inserts nothing.
 */
export async function offerFreedSlot(
  ctx: { businessId: string; logger: Logger },
  freedAppointmentId: string,
  deps: WaitlistDeps = defaultWaitlistDeps,
): Promise<number> {
  const { businessId, logger } = ctx;
  const freed = await waitlistRepo.findFreedAppointment(businessId, freedAppointmentId);
  if (!freed || IS_ACTIVE(freed.status)) return 0;
  const business = await publicBusinessRepo.findById(businessId);
  if (!business) return 0;

  const now = deps.now();
  const expiresAt = offerExpiryFor(now, freed.startAt, business.minNoticeMin);
  if (!expiresAt) {
    logger.info({ businessId, appointmentId: freedAppointmentId }, 'freed slot too close to offer');
    return 0;
  }
  if (
    !(await waitlistRepo.slotIsFree(businessId, freed.staffId, freed.startAt, freed.blockedUntil))
  )
    return 0;

  const candidates = await waitlistRepo.openCandidates(businessId, freed.serviceId);
  if (candidates.length === 0) return 0;
  const busy = await waitlistRepo.busyClientIds(
    businessId,
    [...new Set(candidates.map((c) => c.clientId))],
    freed.startAt,
    freed.endAt,
  );
  // Serialised per slot inside createBatch: the loser of two overlapping runs finds live offers.
  const created = await waitlistRepo.createBatch(businessId, freedAppointmentId, (prior) =>
    matchEntries({
      slot: { staffId: freed.staffId, startAt: freed.startAt, timezone: business.timezone },
      candidates,
      now,
      excludeClientIds: new Set([freed.clientId, ...prior.clientIds]),
      busyClientIds: busy,
      alreadyOfferedEntryIds: prior.entryIds,
      limit: OFFER_BATCH_SIZE,
    }).map((p) => ({
      entryId: p.entryId,
      staffId: freed.staffId,
      startAt: freed.startAt,
      endAt: freed.endAt,
      expiresAt,
      freedFromAppointmentId: freedAppointmentId,
    })),
  );
  if (created.length === 0) return 0;
  logger.info(
    {
      businessId,
      appointmentId: freedAppointmentId,
      batch: created[0]!.batch,
      offers: created.length,
    },
    'waitlist offers created',
  );
  await deliverOffers(created, deps, logger);
  return created.length;
}

/**
 * Hook after a committed cancel. Never throws: the cancel already happened and must not fail because
 * the refill could not be offered.
 */
export async function onSlotFreedOffer(
  ctx: { businessId: string; logger: Logger },
  appointmentId: string,
  deps: WaitlistDeps = defaultWaitlistDeps,
): Promise<void> {
  try {
    await offerFreedSlot(ctx, appointmentId, deps);
  } catch (error) {
    ctx.logger.error(
      { businessId: ctx.businessId, appointmentId, err: safeError(error) },
      'waitlist offering failed after a committed cancel',
    );
  }
}

// ---- offer page and claim ------------------------------------------------------------------------

type ViewStatus = 'OPEN' | 'CLAIMED' | 'EXPIRED' | 'TAKEN';
const viewStatus = (s: OfferRow['status']): ViewStatus => (s === 'SUPERSEDED' ? 'TAKEN' : s);

const price = (v: { toString(): string }) => Number(v.toString());

async function loadOffer(businessId: string, id: string): Promise<OfferRow> {
  const offer = await waitlistRepo.findOffer(businessId, id);
  if (!offer) throw AppError.notFound();
  return offer;
}

export const offersService = {
  /** No side effects: email scanners open these URLs. */
  async get(ctx: { businessId: string }, offerId: string, now: () => Date = () => new Date()) {
    const o = await loadOffer(ctx.businessId, offerId);
    const canClaim =
      o.status === 'OPEN' && o.entry.status === 'OPEN' && now().getTime() < o.expiresAt.getTime();
    return {
      offer: {
        id: o.id,
        status: viewStatus(o.status),
        startAt: o.startAt,
        endAt: o.endAt,
        expiresAt: o.expiresAt,
        service: {
          id: o.entry.service.id,
          name: o.entry.service.name,
          durationMin: o.entry.service.durationMin,
          price: price(o.entry.service.price),
        },
        staff: o.staff,
      },
      business: o.business,
      canClaim,
    };
  },

  /** Claim = a normal booking through the one insert path; the database referee picks the winner. */
  async claim(
    ctx: { businessId: string; requestId: string; logger: Logger },
    offerId: string,
    deps: WaitlistDeps = defaultWaitlistDeps,
  ): Promise<BookingResult> {
    const { businessId } = ctx;
    const o = await loadOffer(businessId, offerId);
    const now = deps.now();
    if (o.status === 'EXPIRED' || (o.status === 'OPEN' && now.getTime() >= o.expiresAt.getTime()))
      throw AppError.gone('OFFER_EXPIRED', 'This offer has expired.');
    if (o.status === 'SUPERSEDED')
      throw AppError.conflict('SLOT_TAKEN', { slots: [] }, 'Someone else took this spot.');
    // An entry that is already fulfilled (another slot claimed) or cancelled must not book anything new.
    // A CLAIMED offer is the replay path and goes on to book() with the same key.
    if (o.status !== 'CLAIMED' && o.entry.status !== 'OPEN')
      throw AppError.conflict(
        'CONFLICT',
        undefined,
        'This waitlist entry is no longer active, so the offer cannot be claimed.',
      );

    let result: BookingResult;
    try {
      result = await book(
        { businessId, requestId: ctx.requestId, logger: ctx.logger },
        {
          serviceId: o.entry.serviceId,
          staffId: o.staffId,
          startAt: o.startAt,
          client: {
            name: o.entry.client.name,
            phone: o.entry.client.phone,
            email: o.entry.client.email ?? undefined,
          },
          source: 'WAITLIST',
          idempotencyKey: offerBookingKey(o.id),
        },
        bookDepsOf(deps),
      );
    } catch (error) {
      if (error instanceof AppError && error.code === 'SLOT_TAKEN') {
        await waitlistRepo.supersede(businessId, o.id);
        ctx.logger.info({ businessId, offerId: o.id }, 'waitlist offer lost the slot (TAKEN)');
      }
      throw error;
    }
    // A repeat claim must not hand back a booking that has since been cancelled.
    if (result.replay && !IS_ACTIVE(result.appointment.status))
      throw AppError.conflict('CONFLICT', undefined, 'That booking was cancelled.');
    // Idempotent bookkeeping: also repairs a claim that booked but crashed before recording.
    await waitlistRepo.markClaimed(businessId, {
      offerId: o.id,
      entryId: o.entryId,
      freedFromAppointmentId: o.freedFromAppointmentId,
      appointmentId: result.appointment.id,
    });
    ctx.logger.info(
      { businessId, offerId: o.id, appointmentId: result.appointment.id, replay: result.replay },
      'waitlist offer claimed',
    );
    return result;
  },
};

// ---- expiry cascade ------------------------------------------------------------------------------

export interface ExpiryResult {
  expired: number;
  offered: number;
}

/** The route's maxDuration is 60 s. */
export const EXPIRY_RUN_BUDGET_MS = 45_000;
/** Do not resend an offer in its first minute: the original send may still be in flight. */
const RESEND_AFTER_MS = 60_000;

/** Offers whose first email failed (provider outage) are sent again; the offer-id key makes it safe. */
async function resendUnsent(
  now: Date,
  deps: WaitlistDeps,
  logger: Logger,
  clock: () => number,
  startedAt: number,
  budgetMs: number,
) {
  const due = await waitlistRepo.unsentOffers(now, new Date(now.getTime() - RESEND_AFTER_MS), 100);
  const byBusiness = new Map<string, string[]>();
  for (const d of due)
    byBusiness.set(d.businessId, [...(byBusiness.get(d.businessId) ?? []), d.id]);
  for (const [businessId, ids] of byBusiness) {
    if (clock() - startedAt > budgetMs) return;
    try {
      const offers = await waitlistRepo.findOffers(businessId, ids);
      const sent = await deliverOffers(offers, deps, logger.child({ businessId }));
      logger.info({ businessId, offers: offers.length, sent }, 'waitlist offers resent');
    } catch (error) {
      logger.error({ businessId, err: safeError(error) }, 'waitlist offer resend failed');
    }
  }
}

/**
 * Cron: expire due offers, then offer the next batch for every freed slot with no live offer left.
 * Overlapping runs are safe: expiry is one conditional UPDATE and offer creation is
 * INSERT ... ON CONFLICT DO NOTHING on (entryId, freedFromAppointmentId).
 */
export async function runWaitlistExpiry(
  logger: Logger,
  deps: WaitlistDeps = defaultWaitlistDeps,
): Promise<ExpiryResult> {
  const now = deps.now();
  const clock = deps.monotonic ?? (() => performance.now());
  const startedAt = clock();
  const budgetMs = deps.budgetMs ?? EXPIRY_RUN_BUDGET_MS;
  const expired = await waitlistRepo.expireDue(now);
  await resendUnsent(now, deps, logger, clock, startedAt, budgetMs);
  const slots = await waitlistRepo.cascadeCandidates(now, 200);
  let offered = 0;
  for (const slot of slots) {
    if (clock() - startedAt > budgetMs) {
      logger.warn({ remaining: slots.length }, 'waitlist expiry run out of time; rest next run');
      break;
    }
    const log = logger.child({ businessId: slot.businessId });
    try {
      offered += await offerFreedSlot(
        { businessId: slot.businessId, logger: log },
        slot.freedFromAppointmentId,
        deps,
      );
    } catch (error) {
      log.error(
        { appointmentId: slot.freedFromAppointmentId, err: safeError(error) },
        'waitlist cascade failed for a slot',
      );
    }
  }
  logger.info({ expired: expired.length, offered }, 'waitlist expiry run finished');
  return { expired: expired.length, offered };
}

// ---- staff side ----------------------------------------------------------------------------------

export const waitlistStaffService = {
  async list(ctx: SessionContext, q: { status: 'OPEN' | 'all'; limit: number }) {
    const rows = await waitlistRepo.listEntries(ctx.businessId, {
      openOnly: q.status === 'OPEN',
      limit: q.limit,
    });
    return {
      entries: rows.map((e) => ({
        id: e.id,
        client: { name: e.client.name, phone: e.client.phone },
        service: e.service,
        staff: e.staff,
        fromDate: toLocalDate(e.fromDate),
        toDate: toLocalDate(e.toDate),
        status: e.status,
        createdAt: e.createdAt,
      })),
    };
  },

  async activity(ctx: SessionContext, limit: number) {
    const rows = await waitlistRepo.activity(ctx.businessId, limit);
    return {
      items: summarizeActivity(
        rows.map((r) => ({
          id: r.id,
          status: r.status,
          startAt: r.startAt,
          expiresAt: r.expiresAt,
          createdAt: r.createdAt,
          freedFromAppointmentId: r.freedFromAppointmentId,
          claimedAt: r.claimedAppointment?.createdAt ?? null,
          service: r.entry.service,
          staff: r.staff,
          clientName: r.entry.client.name,
        })),
        limit,
      ),
    };
  },

  async cancel(ctx: SessionContext, id: string) {
    const res = await waitlistRepo.cancelEntry(ctx.businessId, id);
    if (res === 'missing') throw AppError.notFound();
    if (res === 'fulfilled')
      throw AppError.conflict('CONFLICT', undefined, 'This waitlist entry was already fulfilled.');
    ctx.logger.info({ businessId: ctx.businessId, entryId: id }, 'waitlist entry cancelled');
  },
};
