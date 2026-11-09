import { createHash } from 'node:crypto';
import { JoinWaitlistBody } from '@/server/contracts/waitlist';
import { PublicBookingBody } from '@/server/contracts/booking';
import type { DirectoryQueryT } from '@/server/contracts/directory';
import { extractLinkToken } from '@/server/domain/linkInput';
import { localDayOf } from '@/server/domain/dateRange';
import { addLocalDays, isRealDate, localLabel, localToday, toLocalIso } from '@/server/domain/localTime';
import { normalizePhone } from '@/server/domain/phone';
import {
  PREPARE_TTL_SEC,
  signPrepareToken,
  verifyPrepareToken,
} from '@/server/domain/prepareToken';
import { getServerEnv, requireLinkSecret } from '@/server/env';
import { AppError } from '@/server/http/errors';
import { resolveToken } from '@/server/http/auth';
import { verifyToken } from '@/server/domain/tokens';
import { reminderJobRepo } from '@/server/repositories/reminderJob.repo';
import { waitlistRepo } from '@/server/repositories/waitlist.repo';
import type { Logger } from '@/server/http/logger';
import type { RouteContext } from '@/server/http/withRoute';
import { publicBusinessRepo } from '@/server/repositories/publicBusiness.repo';
import { cleanText, ADDRESS_MAX } from '@/server/mcp/sanitize';
import { availabilityService, type PublicSlot } from './availability';
import { type BookDeps } from './booking';
import { directoryService } from './directory';
import { linksService } from './links';
import { publicBookingService } from './publicBooking';
import { rateLimiter } from './rateLimit';
import { joinWaitlist } from './waitlist';
import { EMAIL_BUDGET_WARN } from './reminders';
import {
  emailSubject,
  phoneSubject,
  spend,
  spendMany,
  tokenSubject,
  type AssistantLimiter,
} from './assistantLimits';

/**
 * The assistant (MCP) use cases. Everything here reuses an existing service: the directory, the public slot
 * engine, THE booking insert (publicBookingService.book -> book()), the public waitlist and the link actions.
 * Only businesses with `listed = true` are visible; a slug that is unknown or unlisted is simply "not found".
 * Business-entered strings are sanitized before they leave (see mcp/sanitize.ts).
 */

export interface AssistantCtx {
  requestId: string;
  logger: Logger;
  /** Called as soon as the business is known, so the caller can log the id. */
  onBusiness?: (businessId: string) => void;
}

export interface AssistantDeps {
  now: () => Date;
  limiter: AssistantLimiter;
  linkSecret: () => string;
  appUrl: () => string;
  /**
   * Emails sent today by ALL tenants (reminders plus waitlist offers), counted exactly as reminders.ts counts its
   * daily budget. The chat connector refuses writes once it reaches EMAIL_BUDGET_WARN.
   */
  emailsSentToday: (now: Date) => Promise<number>;
  /** Queued + sent emails (all tenants) of one UTC day, see reminderJobRepo.emailLoadForUtcDay. */
  emailLoadOnDay: (dayStart: Date, now: Date) => Promise<number>;
  /** Test seam for the booking path (fake payments, fixed clock). */
  bookDeps?: BookDeps | undefined;
}

export const defaultAssistantDeps: AssistantDeps = {
  now: () => new Date(),
  limiter: rateLimiter,
  linkSecret: () => requireLinkSecret(),
  appUrl: () => getServerEnv().APP_URL,
  emailLoadOnDay: async (dayStart, now) => {
    const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000);
    const load = await reminderJobRepo.emailLoadForUtcDay(dayStart, dayEnd);
    // Today also carries the waitlist offers sent so far (the daily budget counts them).
    return now >= dayStart && now < dayEnd ? load + (await waitlistRepo.countOffersSince(dayStart)) : load;
  },
  emailsSentToday: async (now) => {
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return (
      (await reminderJobRepo.countSentEmailsSince(dayStart)) +
      (await waitlistRepo.countOffersSince(dayStart))
    );
  },
};

/** The directory's live budget is per ip and would be one shared bucket here: the connector has its own. */
const NO_IP_BUDGET = {
  consume: async () => ({ limited: false, retryAfterSec: 0, count: 0 }),
};

const MAX_SLOTS = 60;
export const SEARCH_LIMIT_MAX = 10;
export const FREE_DAYS_MAX = 7;

const num = (v: { toString(): string }) => Number(v.toString());
const asRoute = (ctx: AssistantCtx): RouteContext => ({
  requestId: ctx.requestId,
  logger: ctx.logger,
});

async function listed(ctx: AssistantCtx, slug: string) {
  const business = await publicBusinessRepo.findListedBySlug(slug.trim().toLowerCase());
  if (!business) throw AppError.notFound('No listed business has that slug.');
  ctx.onBusiness?.(business.id);
  return business;
}

type Listed = NonNullable<Awaited<ReturnType<typeof publicBusinessRepo.findListedBySlug>>>;

function slotView(slot: PublicSlot, timezone: string) {
  const at = new Date(slot.startAt);
  return {
    startAt: toLocalIso(at, timezone),
    localLabel: localLabel(at, timezone),
    ...(slot.staffId ? { staffId: slot.staffId } : {}),
  };
}

const bookingUrl = (deps: AssistantDeps, slug: string) => `${deps.appUrl()}/b/${slug}`;

export const CHAT_UNAVAILABLE_MESSAGE =
  'Booking by chat is temporarily unavailable. Please use the business booking page instead.';

/** Refuse chat writes once today's emails (all tenants) reach the budget's warning level (reminders.ts). */
async function guardEmailBudget(deps: AssistantDeps): Promise<void> {
  const used = await deps.emailsSentToday(deps.now());
  if (used >= EMAIL_BUDGET_WARN)
    throw new AppError(503, 'CHAT_BOOKING_UNAVAILABLE', CHAT_UNAVAILABLE_MESSAGE);
}

/** A day is full for chat bookings at EMAIL_BUDGET_WARN - 10 = 70 queued + sent emails (after adding this booking's). */
export const PROJECTED_DAY_LIMIT = EMAIL_BUDGET_WARN - 10;
export const DAY_UNAVAILABLE_MESSAGE =
  'Booking by chat is temporarily unavailable for that day. Please use the business booking page instead.';

const utcDayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Projected load: a booking at T queues an H24 email due at T - 24 h and an H2 email due at T - 2 h (see
 * reminderWindows.ts), each counted on the UTC day it falls on (the days the sender's daily budget counts). Reminders are never budget-gated, so refuse when either day
 * already carries queued + sent emails that, with this booking's one, reach PROJECTED_DAY_LIMIT. Global (all
 * tenants) because the Resend quota is. Fails CLOSED: a failing count refuses the booking.
 */
export async function guardProjectedLoad(deps: AssistantDeps, start: Date): Promise<void> {
  const now = deps.now();
  const h24 = utcDayStart(new Date(start.getTime() - 24 * 3_600_000));
  const h2 = utcDayStart(new Date(start.getTime() - 2 * 3_600_000));
  // Both reminders on one UTC day (start between 00:00 and 02:00 UTC): that day takes two emails.
  const checks: [Date, number][] = h24.getTime() === h2.getTime() ? [[h24, 2]] : [[h24, 1], [h2, 1]];
  for (const [day, added] of checks) {
    const load = await deps.emailLoadOnDay(day, now);
    if (load + added >= PROJECTED_DAY_LIMIT)
      throw new AppError(503, 'CHAT_BOOKING_UNAVAILABLE', DAY_UNAVAILABLE_MESSAGE);
  }
}

export function createAssistantService(deps: AssistantDeps = defaultAssistantDeps) {
  async function catalogue(business: Listed) {
    const { services, staff } = await publicBusinessRepo.catalogue(business.id);
    return {
      services: services.map((s) => ({
        id: s.id,
        name: cleanText(s.name),
        durationMin: s.durationMin,
        price: num(s.price),
        currency: business.currency,
      })),
      staff: staff.map((s) => ({
        id: s.id,
        name: cleanText(s.displayName),
        serviceIds: s.services.map((x) => x.serviceId),
        bookable: true,
      })),
    };
  }

  async function readBudget(businessId: string) {
    await spend(deps.limiter, 'mcpReadBusiness', businessId, 'open');
  }

  return {
    async search(
      _ctx: AssistantCtx,
      input: { query?: string | undefined; category?: string | undefined; area?: string | undefined; limit?: number | undefined },
    ) {
      const limit = Math.min(Math.max(input.limit ?? 5, 1), SEARCH_LIMIT_MAX);
      const res = await directoryService.list(
        {
          search: input.query,
          category: input.category,
          area: input.area,
          include: 'nextFree',
          limit,
        } as DirectoryQueryT,
        undefined,
        { now: deps.now, limiter: NO_IP_BUDGET },
      );
      return {
        businesses: res.businesses.map((b) => {
          const tz = b.timezone;
          const next = b.nextFree;
          return {
            slug: b.slug,
            name: cleanText(b.name),
            category: b.category ? cleanText(b.category, 40) : null,
            area: b.area ? cleanText(b.area, 40) : null,
            address: b.address ? cleanText(b.address, ADDRESS_MAX) : null,
            serviceCount: b.serviceCount,
            fromPrice: b.fromPrice,
            nextFree:
              next && tz
                ? {
                    startAt: toLocalIso(new Date(next.startAt), tz),
                    localLabel: localLabel(new Date(next.startAt), tz),
                    serviceName: cleanText(next.service.name),
                  }
                : null,
          };
        }),
      };
    },

    async getBusiness(ctx: AssistantCtx, slug: string) {
      const business = await listed(ctx, slug);
      await readBudget(business.id);
      const { services, staff } = await catalogue(business);
      return {
        business: {
          slug: business.slug,
          name: cleanText(business.name),
          category: business.category ? cleanText(business.category, 40) : null,
          area: business.area ? cleanText(business.area, 40) : null,
          address: business.address ? cleanText(business.address, ADDRESS_MAX) : null,
          timezone: business.timezone,
          bookingWindowDays: business.bookingWindowDays,
          cancelCutoffMin: business.cancelCutoffMin,
          bookingPageUrl: bookingUrl(deps, business.slug),
        },
        services,
        staff,
      };
    },

    async freeTimes(
      ctx: AssistantCtx,
      input: {
        slug: string;
        serviceId: string;
        staffId?: string | undefined;
        fromDate?: string | undefined;
        days?: number | undefined;
      },
    ) {
      const business = await listed(ctx, input.slug);
      await readBudget(business.id);
      const now = deps.now();
      const days = Math.min(Math.max(input.days ?? 3, 1), FREE_DAYS_MAX);
      const today = localToday(now, business.timezone);
      if (input.fromDate !== undefined && !isRealDate(input.fromDate))
        throw AppError.validation({ fromDate: 'Use a real date like 2026-11-10.' });
      const from = input.fromDate && input.fromDate > today ? input.fromDate : today;
      const to = addLocalDays(from, days - 1);
      const slots = await availabilityService.slots(
        business,
        { serviceId: input.serviceId, staffId: input.staffId, from, to },
        now,
      ).catch((error: unknown) => {
        if (error instanceof AppError && error.status === 404)
          throw AppError.notFound('That service or staff member was not found for this business.');
        throw error;
      });
      return {
        timezone: business.timezone,
        from,
        to,
        times: slots.slice(0, MAX_SLOTS).map((s) => slotView(s, business.timezone)),
        truncated: slots.length > MAX_SLOTS,
        total: slots.length,
        note: 'Times can be taken by someone else before you book.',
      };
    },

    async prepare(
      ctx: AssistantCtx,
      input: { slug: string; serviceId: string; staffId?: string | undefined; startAt: string },
    ) {
      const business = await listed(ctx, input.slug);
      await readBudget(business.id);
      const now = deps.now();
      const start = new Date(input.startAt);
      if (Number.isNaN(start.getTime()))
        throw AppError.validation({ startAt: 'Use a time like 2026-11-11T18:30:00+02:00.' });
      const { services, staff } = await catalogue(business);
      const service = services.find((s) => s.id === input.serviceId);
      if (!service) throw AppError.notFound('That service was not found for this business.');
      const member = input.staffId ? staff.find((s) => s.id === input.staffId) : undefined;
      if (input.staffId && !member)
        throw AppError.notFound('That staff member was not found for this business.');
      if (member && !member.serviceIds.includes(service.id))
        throw AppError.validation({ staffId: 'This person does not offer that service.' });
      const day = localDayOf(start, business.timezone).date;
      const slots = await availabilityService.slots(
        business,
        { serviceId: service.id, staffId: input.staffId, from: day, to: day },
        now,
      );
      const iso = start.toISOString();
      if (!slots.some((s) => s.startAt === iso))
        throw AppError.conflict(
          'SLOT_TAKEN',
          {
            freeTimes: slots.slice(0, 12).map((s) => slotView(s, business.timezone)),
            timezone: business.timezone,
          },
          'That time is not offered (or was just taken).',
        );
      const exp = Math.floor(now.getTime() / 1000) + PREPARE_TTL_SEC;
      const confirmationToken = signPrepareToken(
        { b: business.id, s: service.id, p: input.staffId ?? null, t: iso, exp },
        deps.linkSecret(),
      );
      return {
        summary: {
          business: cleanText(business.name),
          service: service.name,
          staff: member ? member.name : null,
          startAt: toLocalIso(start, business.timezone),
          localLabel: localLabel(start, business.timezone),
          timezone: business.timezone,
          price: service.price,
          currency: service.currency,
          durationMin: service.durationMin,
        },
        confirmationToken,
        expiresInMinutes: PREPARE_TTL_SEC / 60,
        expiresAt: new Date(exp * 1000).toISOString(),
        nothingBookedYet: true,
      };
    },

    async createBooking(
      ctx: AssistantCtx,
      input: { confirmationToken: string; name: string; phone: string; email: string },
    ) {
      const now = deps.now();
      const secret = deps.linkSecret();
      const verified = verifyPrepareToken(input.confirmationToken.trim(), secret, now);
      if (!verified.ok)
        throw verified.reason === 'expired'
          ? AppError.gone(
              'LINK_EXPIRED',
              'This confirmation expired (they last 10 minutes). Call prepare_booking again for a fresh one.',
            )
          : AppError.validation({
              confirmationToken:
                'This confirmation token is not valid. Call prepare_booking to get one.',
            });
      const p = verified.payload;
      const business = await publicBusinessRepo.findListedById(p.b);
      if (!business) throw AppError.notFound('That business is not available for assistant bookings.');
      ctx.onBusiness?.(business.id);

      const body = PublicBookingBody.safeParse({
        serviceId: p.s,
        staffId: p.p ?? 'anyone',
        startAt: p.t,
        client: { name: input.name, phone: input.phone, email: input.email },
      });
      if (!body.success) {
        const fields: Record<string, string> = {};
        for (const issue of body.error.issues)
          fields[issue.path.slice(1).join('.') || 'confirmationToken'] ??= issue.message;
        throw AppError.validation(fields);
      }
      const phone = normalizePhone(body.data.client.phone);
      if (!phone) throw AppError.validation({ phone: 'Enter a valid phone number.' });

      // Everything above is validation (no spend). From here: the email budget guard (a read), then the limits,
      // per email, phone, business and the global hour and day caps. All fail closed; a refused or failed call
      // gives back every hit (see below), so only a real booking is counted.
      await guardEmailBudget(deps);
      await guardProjectedLoad(deps, new Date(p.t));
      const spent = await spendMany(
        deps.limiter,
        [
          { policy: 'mcpEmail', subject: emailSubject(secret, body.data.client.email) },
          { policy: 'mcpPhone', subject: phoneSubject(secret, phone) },
          { policy: 'mcpPhoneDay', subject: phoneSubject(secret, phone) },
          { policy: 'mcpBookBusinessDay', subject: business.id },
          { policy: 'mcpBookHour', subject: 'all' },
          { policy: 'mcpBookDay', subject: 'all' },
        ],
        'closed',
      );
      const key = createHash('sha256')
        .update(`${input.confirmationToken.trim()}|${phone}`)
        .digest('hex');
      try {
        const result = await publicBookingService.book(
          asRoute(ctx),
          business.slug,
          body.data,
          key,
          deps.bookDeps,
        );
        // A replay is the same booking again: it must not count twice (the first call already did).
        if (result.replay) await spent.refund();
        const a = result.appointment;
        const tz = business.timezone;
        return {
          reference: a.reference,
          status: result.status ?? a.status,
          startAt: toLocalIso(a.startAt, tz),
          localLabel: localLabel(a.startAt, tz),
          timezone: tz,
          business: cleanText(business.name),
          service: cleanText(a.service.name),
          staff: cleanText(a.staff.displayName),
          manageUrl: result.links.manage,
          manageNote: 'This one link shows, confirms or cancels the booking.',
          alreadyBooked: result.replay,
          ...(result.payUrl && result.holdExpiresAt
            ? {
                depositRequired: true,
                payUrl: result.payUrl,
                holdMinutes: Math.max(
                  1,
                  Math.ceil((result.holdExpiresAt.getTime() - now.getTime()) / 60_000),
                ),
              }
            : {}),
        };
      } catch (error) {
        await spent.refund(); // a failed booking (slot taken, validation, deposit...) costs nothing
        if (error instanceof AppError && error.code === 'SLOT_TAKEN') {
          const slots = ((error.data as { slots?: PublicSlot[] } | undefined)?.slots ?? []).slice(
            0,
            12,
          );
          throw AppError.conflict(
            'SLOT_TAKEN',
            {
              freeTimes: slots.map((s) => slotView(s, business.timezone)),
              timezone: business.timezone,
            },
            'That time was just taken by someone else.',
          );
        }
        throw error;
      }
    },

    async joinWaitlist(
      ctx: AssistantCtx,
      input: {
        slug: string;
        serviceId: string;
        staffId?: string | undefined;
        dateFrom: string;
        dateTo: string;
        name: string;
        phone: string;
        email: string;
      },
    ) {
      const business = await listed(ctx, input.slug);
      const body = JoinWaitlistBody.safeParse({
        serviceId: input.serviceId,
        staffId: input.staffId ?? null,
        fromDate: input.dateFrom,
        toDate: input.dateTo,
        client: { name: input.name, phone: input.phone, email: input.email },
      });
      if (!body.success) {
        const fields: Record<string, string> = {};
        for (const issue of body.error.issues) {
          const key = issue.path.join('.').replace('fromDate', 'dateFrom').replace('toDate', 'dateTo');
          fields[key || 'input'] ??= issue.message;
        }
        throw AppError.validation(fields);
      }
      const phone = normalizePhone(body.data.client.phone);
      if (!phone) throw AppError.validation({ phone: 'Enter a valid phone number.' });
      const secret = deps.linkSecret();
      await guardEmailBudget(deps);
      const byPhone = await spendMany(
        deps.limiter,
        [
          { policy: 'mcpEmailWait', subject: emailSubject(secret, body.data.client.email) },
          { policy: 'mcpPhone', subject: phoneSubject(secret, phone) },
          { policy: 'mcpPhoneDay', subject: phoneSubject(secret, phone) },
          { policy: 'mcpWaitHour', subject: 'all' },
          { policy: 'mcpWaitDay', subject: 'all' },
        ],
        'closed',
      );
      try {
        const { existing, entry } = await joinWaitlist(
          asRoute(ctx),
          business.slug,
          body.data,
          deps.now,
        );
        if (existing) await byPhone.refund();
        return {
          business: cleanText(business.name),
          alreadyOnWaitlist: existing,
          entry: {
            serviceId: entry.serviceId,
            staffId: entry.staffId,
            dateFrom: entry.fromDate,
            dateTo: entry.toDate,
          },
          note: 'If a matching time opens up, an email with a link to claim it is sent to the address given.',
        };
      } catch (error) {
        await byPhone.refund();
        // The waitlist service names its fields fromDate/toDate; the tool calls them dateFrom/dateTo.
        if (error instanceof AppError && error.status === 400 && error.code === 'VALIDATION_FAILED')
          throw AppError.validation(
            Object.fromEntries(
              Object.entries(error.fields).map(([k, v]) => [
                k === 'fromDate' ? 'dateFrom' : k === 'toDate' ? 'dateTo' : k,
                v,
              ]),
            ),
          );
        throw error;
      }
    },

    async linkView(ctx: AssistantCtx, rawToken: string, action?: 'confirm' | 'cancel') {
      const token = extractLinkToken(rawToken);
      if (!token)
        throw AppError.validation({
          token: 'Paste the booking link from the confirmation email (it contains /l/...), or the token itself.',
        });
      const now = deps.now();
      const secret = deps.linkSecret();
      // Signature, expiry and act first, WITHOUT the database and without spending anything: a forged or
      // stale token costs only the cheap invalid-call bucket (counted by the caller), never a write budget.
      let valid = false;
      let expired = false;
      for (const act of ['view', 'confirm', 'cancel'] as const) {
        const v = verifyToken(token, secret, now, act);
        if (v.ok) {
          valid = true;
          break;
        }
        if (v.reason === 'expired') expired = true;
        if (v.reason !== 'wrong_action') break;
      }
      if (!valid) throw expired ? AppError.gone() : AppError.notFound('That link or token is not valid.');
      // Per token (20 an hour), not per connector. A failed call gives its hit back.
      const spentLink = await spend(
        deps.limiter,
        'mcpLinkToken',
        tokenSubject(secret, token),
        action ? 'closed' : 'open',
      );
      let view: Awaited<ReturnType<typeof linksService.get>> & { result?: string };
      try {
        const identity = await resolveToken(token, ['view', 'confirm', 'cancel'], now);
        ctx.onBusiness?.(identity.businessId);
        const linkCtx = { businessId: identity.businessId, logger: ctx.logger };
        view = action
          ? await linksService.act(linkCtx, identity, action, deps.now)
          : await linksService.get(linkCtx, identity, deps.now);
      } catch (error) {
        await spentLink.refund();
        throw error;
      }
      const a = view.appointment;
      const tz = view.business.timezone;
      const result: string | undefined = 'result' in view ? String(view.result) : undefined;
      return {
        reference: a.reference,
        status: a.status,
        startAt: toLocalIso(a.startAt, tz),
        localLabel: localLabel(a.startAt, tz),
        timezone: tz,
        business: cleanText(view.business.name),
        service: cleanText(a.service.name),
        staff: cleanText(a.staff.displayName),
        canConfirm: view.canConfirm,
        canCancel: view.canCancel,
        cancelWithoutPenaltyUntil: localLabel(view.cancelCutoffAt, tz),
        pastCancelDeadline: view.pastCutoff,
        ...(result ? { result, resultMeaning: RESULT_MEANING[result] } : {}),
      };
    },
  };
}

const RESULT_MEANING: Record<string, string> = {
  confirmed: 'The appointment is now confirmed.',
  already_confirmed: 'The appointment was already confirmed.',
  cancelled: 'The appointment is cancelled.',
  late_cancelled:
    'The appointment is cancelled, after the business cancellation deadline, so it is recorded as a late cancellation.',
  already_cancelled: 'The appointment was already cancelled.',
};

export type AssistantService = ReturnType<typeof createAssistantService>;
export const assistantService: AssistantService = createAssistantService();

