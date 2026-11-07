import { DateTime } from 'luxon';
import {
  generateSlots,
  mergeAnyone,
  type BusyInterval,
  type UtcInterval,
  type WeeklyInterval,
} from './slots';

/**
 * "Next free" for the public directory and the home page. Pure: `now` and every row are injected, and all slot
 * logic is the one `generateSlots` engine (minimum notice, booking window, hours, time off, bookings, buffers,
 * DST). Nothing here re-implements it.
 *
 * DEFINITION. A business's next free time is the earliest bookable start of its SHORTEST active service that
 * at least one active, bookable staff member with working hours performs, searched over the next
 * NEXT_FREE_DAYS local days (today included, in the business timezone). `freeTimes` are up to FREE_TIMES_MAX
 * distinct start instants on the first local day that has any. Ties between equally short services: lower
 * price, then name, then id.
 */
export const NEXT_FREE_DAYS = 7;
export const FREE_TIMES_MAX = 4;

export interface DirBusiness {
  id: string;
  timezone: string;
  slotStepMin: number;
  bookingWindowDays: number;
  minNoticeMin: number;
}

export interface DirService {
  id: string;
  name: string;
  durationMin: number;
  bufferMin: number;
  price: number;
}

export interface DirStaff {
  id: string;
  /** Ids of the active services this person performs. */
  serviceIds: string[];
  weeklyHours: WeeklyInterval[];
  timeOff: UtcInterval[];
  busy: BusyInterval[];
}

export interface NextFree {
  service: { id: string; name: string; durationMin: number };
  startAt: Date;
  freeTimes: Date[];
}

const byShortest = (a: DirService, b: DirService) =>
  a.durationMin - b.durationMin ||
  a.price - b.price ||
  (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The shortest service that someone with working hours performs, or null. */
export function pickShortestService(services: DirService[], staff: DirStaff[]): DirService | null {
  const able = staff.filter((s) => s.weeklyHours.length > 0);
  const offered = services.filter((svc) => able.some((s) => s.serviceIds.includes(svc.id)));
  return offered.sort(byShortest)[0] ?? null;
}

/** The inclusive local-date window `[today, today + NEXT_FREE_DAYS - 1]` in the business timezone. */
export function localWindow(now: Date, timezone: string): { from: string; to: string } {
  const today = DateTime.fromJSDate(now, { zone: timezone }).startOf('day');
  return {
    from: today.toISODate()!,
    to: today.plus({ days: NEXT_FREE_DAYS - 1 }).toISODate()!,
  };
}

/**
 * Next free time for one business. `window` overrides the default 7 days (the `when` filter passes one local
 * day). Returns null when nothing is bookable in the window.
 */
export function computeNextFree(
  business: DirBusiness,
  services: DirService[],
  staff: DirStaff[],
  now: Date,
  window?: { from: string; to: string },
): NextFree | null {
  const service = pickShortestService(services, staff);
  if (!service) return null;
  const able = staff
    .filter((s) => s.serviceIds.includes(service.id) && s.weeklyHours.length > 0)
    .map((s) => ({ id: s.id, weeklyHours: s.weeklyHours, timeOff: s.timeOff, busy: s.busy }));
  const range = window ?? localWindow(now, business.timezone);
  const dayOf = (d: Date) => DateTime.fromJSDate(d, { zone: business.timezone }).toISODate();

  // One local day at a time: the answer lives on the first day that has a slot, so later days are never
  // generated. Each call is the unchanged engine over a one-day range, so the result equals one big call.
  const last = DateTime.fromISO(range.to, { zone: 'utc' });
  for (
    let day = DateTime.fromISO(range.from, { zone: 'utc' });
    day <= last;
    day = day.plus({ days: 1 })
  ) {
    const date = day.toISODate()!;
    const slots = generateSlots({
      service: { durationMin: service.durationMin, bufferMin: service.bufferMin },
      staff: able,
      slotStepMin: business.slotStepMin,
      minNoticeMin: business.minNoticeMin,
      bookingWindowDays: business.bookingWindowDays,
      timezone: business.timezone,
      now,
      range: { from: date, to: date },
    });
    const merged = mergeAnyone(slots);
    // A local day can start before midnight UTC and end after it: keep only starts that belong to this local day.
    const todays = merged.filter((m) => dayOf(m.startAt) === date);
    if (todays.length === 0) continue;
    return {
      service: { id: service.id, name: service.name, durationMin: service.durationMin },
      startAt: todays[0]!.startAt,
      freeTimes: todays.slice(0, FREE_TIMES_MAX).map((m) => m.startAt),
    };
  }
  return null;
}

/** The item whose next free instant is earliest (a tie keeps the first), or null when none has one. */
export function earliestNextFree<T extends { nextFree: { startAt: Date } | null }>(
  items: T[],
): T | null {
  let best: T | null = null;
  for (const item of items) {
    if (!item.nextFree) continue;
    if (!best || item.nextFree.startAt.getTime() < best.nextFree!.startAt.getTime()) best = item;
  }
  return best;
}

/** Like `Promise.all(items.map(fn))` but at most `limit` calls in flight; results keep the input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return out;
}
