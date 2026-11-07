import {
  computeNextFree,
  mapLimit,
  type DirBusiness,
  type NextFree,
} from '@/server/domain/nextFree';
import type { Weekday } from '@/server/domain/slots';
import { UNKNOWN_IP } from '@/server/http/clientIp';
import { AppError } from '@/server/http/errors';
import { availabilityRepo } from '@/server/repositories/availability.repo';
import { routeRateLimitDisabled, type RateLimiter } from './rateLimit';

/**
 * The per-IP budget of the costly public reads (policy `directoryLive`). Unlike the cheap reads, an address we
 * cannot derive does NOT skip the limit: all such requests share one bucket (`unknown`), because these calls
 * compute slots and an unlimited anonymous path would be the cheapest way to load the database. On Vercel the
 * address is always present (x-vercel-forwarded-for), so the shared bucket only catches a misconfiguration.
 */
export async function consumeLiveBudget(
  limiter: Pick<RateLimiter, 'consume'>,
  ip: string | undefined,
): Promise<void> {
  if (routeRateLimitDisabled()) return;
  const decision = await limiter.consume('directoryLive', ip ?? UNKNOWN_IP);
  if (decision.limited) throw AppError.rateLimited(decision.retryAfterSec);
}

/**
 * `when` can only have free slots between today (in the business zone) and today + bookingWindowDays. Zones
 * differ by at most a day from UTC, so a day more than 1 before the UTC date, or more than maxWindowDays + 1
 * after it, is outside EVERY business's window: the caller answers an empty page without any slot query.
 */
export function whenOutsideEveryWindow(when: string, now: Date, maxWindowDays: number): boolean {
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
  const today = day(now.toISOString().slice(0, 10));
  const DAY = 86_400_000;
  const w = day(when);
  return w < today - DAY || w > today + (maxWindowDays + 1) * DAY;
}

/** At most this many businesses have their slots computed at the same time inside one request. */
export const LIVE_CONCURRENCY = 4;

export interface LiveResult {
  slug: string;
  name: string;
  timezone: string;
  nextFree: NextFree | null;
}

const DAY_MS = 86_400_000;

/**
 * Live "next free" for a BOUNDED set of listed businesses (callers pass at most a page: 12, or 6 per
 * category). Everything is batch-loaded in a fixed number of queries (availabilityRepo.loadMany), then the one
 * pure slot engine runs per business with at most LIVE_CONCURRENCY in flight. Results come back keyed by
 * business id; a business that is not listed any more is simply absent.
 *
 * `day` (yyyy-MM-dd) restricts the search to that local day (the `when` filter); otherwise the next 7 local days.
 */
export async function liveNextFree(
  ids: string[],
  now: Date,
  day?: string,
): Promise<Map<string, LiveResult>> {
  // One UTC window wide enough for any timezone's 7 local days (or the single requested day).
  const anchor = day ? new Date(`${day}T00:00:00Z`) : now;
  const range = day
    ? { start: new Date(anchor.getTime() - DAY_MS), end: new Date(anchor.getTime() + 2 * DAY_MS) }
    : { start: new Date(now.getTime() - DAY_MS), end: new Date(now.getTime() + 9 * DAY_MS) };
  const loaded = await availabilityRepo.loadMany(ids, range, now);

  const entries = await mapLimit(loaded, LIVE_CONCURRENCY, async (l) => {
    // Yield between businesses so a big batch never monopolises the event loop.
    await new Promise<void>((resolve) => setImmediate(resolve));
    const business: DirBusiness = {
      id: l.business.id,
      timezone: l.business.timezone,
      slotStepMin: l.business.slotStepMin,
      bookingWindowDays: l.business.bookingWindowDays,
      minNoticeMin: l.business.minNoticeMin,
    };
    const nextFree = computeNextFree(
      business,
      l.services,
      l.staff.map((s) => ({
        id: s.id,
        serviceIds: s.serviceIds,
        weeklyHours: s.hours.map((h) => ({
          weekday: h.weekday as Weekday,
          startLocal: h.startLocal,
          endLocal: h.endLocal,
        })),
        timeOff: s.timeOff,
        busy: s.busy,
      })),
      now,
      day ? { from: day, to: day } : undefined,
    );
    return [
      l.business.id,
      { slug: l.business.slug, name: l.business.name, timezone: l.business.timezone, nextFree },
    ] as const;
  });
  return new Map(entries);
}
