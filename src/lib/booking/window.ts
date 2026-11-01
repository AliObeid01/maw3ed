import { ApiError } from '@/lib/api/auth';
import { getSlots, type Slot } from '@/lib/api/booking';
import { DAY_WINDOW, dayWindow, groupSlotsByDay } from './slots';

export type SlotWindow = {
  /** Local days the server was asked about (a prefix of the 14-day window). */
  coveredDays: string[];
  byDay: Record<string, Slot[]>;
};

/** The request lengths to try for a window of `days`: the window itself, then 7, 3 and 1 day below it. */
const ladder = (days: number): number[] => {
  const top = Math.min(DAY_WINDOW, Math.max(1, days));
  return [top, ...[7, 3, 1].filter((n) => n < top)];
};

/**
 * Loads the free slots for the day strip in ONE request covering the next local days of the business.
 *
 * The public API publishes the booking window (`bookingWindowDays` on GET /api/public/{slug}) and callers pass it
 * as `maxDays`. A known window shorter than 14 days is requested exactly (one request on the normal path). With
 * the default `maxDays` (14, also what an older server's missing value parses to) the first request covers 14 days.
 *
 * Safety net (finding F28): if the server still rejects the attempted length as too far ahead (400 on `to`, for
 * example the owner shortened the window after the page loaded its business), `refreshWindowDays` is called ONCE to
 * re-read the business. A shorter published window is then tried directly; otherwise the page falls back through
 * 7, 3 and 1 day below the attempted length. Every length is tried at most once, so it can never loop; when all
 * are rejected the last error is thrown.
 */
export async function loadSlotWindow(
  slug: string,
  query: { serviceId: string; staffId?: string },
  timezone: string,
  now: Date,
  signal?: AbortSignal,
  fetchSlots: typeof getSlots = getSlots,
  /** The business's booking window in days (capped at 14). */
  maxDays: number = DAY_WINDOW,
  /** Re-reads GET /api/public/{slug} and returns its `bookingWindowDays` (and lets the caller remember it). Called at most once. */
  refreshWindowDays?: (signal?: AbortSignal) => Promise<number | undefined>,
): Promise<SlotWindow> {
  const days = dayWindow(now, timezone, DAY_WINDOW);
  let lengths = ladder(maxDays);
  const tried = new Set<number>();
  let refreshed = false;
  let last: unknown = new ApiError(0, 'NETWORK', 'unreachable');
  while (lengths.length > 0) {
    const length = lengths.shift()!;
    tried.add(length);
    const covered = days.slice(0, length);
    try {
      const slots = await fetchSlots(
        slug,
        { ...query, from: covered[0]!, to: covered[covered.length - 1]! },
        signal,
      );
      return { coveredDays: covered, byDay: groupSlotsByDay(slots, timezone) };
    } catch (error) {
      const outOfWindow = error instanceof ApiError && error.status === 400 && 'to' in error.fields;
      if (!outOfWindow) throw error;
      last = error;
    }
    if (!refreshed && refreshWindowDays) {
      refreshed = true;
      let published: number | undefined;
      try {
        published = await refreshWindowDays(signal);
      } catch (error) {
        if (signal?.aborted) throw error;
      }
      if (published !== undefined && Math.min(DAY_WINDOW, Math.max(1, published)) < length) {
        lengths = ladder(published).filter((n) => !tried.has(n));
      }
    }
  }
  throw last;
}

const windowKey = (slug: string) => `maw3ed:slot-window:${slug}`;

/**
 * The window length remembered earlier in this browser session for a business (14 when unknown). The booking
 * page does not use it (it passes the published `bookingWindowDays`); it is the read side of
 * `rememberWindowLength`, kept for callers without a published window.
 */
export function readWindowLength(
  slug: string,
  storage: Pick<Storage, 'getItem'> | undefined = typeof sessionStorage === 'undefined' ? undefined : sessionStorage,
): number {
  try {
    const n = Number(storage?.getItem(windowKey(slug)));
    return Number.isInteger(n) && n >= 1 && n < DAY_WINDOW ? n : DAY_WINDOW;
  } catch {
    return DAY_WINDOW;
  }
}

/** Remember a window shorter than 14 days (the waitlist join writes it when the server names the window). */
export function rememberWindowLength(
  slug: string,
  days: number,
  storage: Pick<Storage, 'setItem'> | undefined = typeof sessionStorage === 'undefined' ? undefined : sessionStorage,
) {
  try {
    if (days < DAY_WINDOW) storage?.setItem(windowKey(slug), String(days));
  } catch {
    // Private mode or storage disabled: the probe simply repeats.
  }
}
