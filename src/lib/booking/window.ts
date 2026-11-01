import { ApiError } from '@/lib/api/auth';
import { getSlots, type Slot } from '@/lib/api/booking';
import { DAY_WINDOW, dayWindow, groupSlotsByDay } from './slots';

export type SlotWindow = {
  /** Local days the server was asked about (a prefix of the 14-day window). */
  coveredDays: string[];
  byDay: Record<string, Slot[]>;
};

/**
 * Loads the free slots for the day strip in ONE request covering the next local days of the business.
 *
 * The public API publishes the booking window (`bookingWindowDays` on GET /api/public/{slug}) and callers pass it
 * as `maxDays`. A known window shorter than 14 days is requested exactly (one request, no probing). With the
 * default `maxDays` (14, also what an older server's missing value parses to) the first request covers 14 days,
 * and only if the server rejects it as too far ahead (400 on `to`) is it retried with 7, 3, then 1 day: a safety
 * net, not the main path. A known short window that the server still rejects is not retried (finding F28).
 */
export async function loadSlotWindow(
  slug: string,
  query: { serviceId: string; staffId?: string },
  timezone: string,
  now: Date,
  signal?: AbortSignal,
  fetchSlots: typeof getSlots = getSlots,
  /** The business's booking window in days. Below 14 it is requested exactly; 14 or more is capped at 14 and may be probed down. */
  maxDays: number = DAY_WINDOW,
): Promise<SlotWindow> {
  const days = dayWindow(now, timezone, DAY_WINDOW);
  // The business's real booking window is known (GET /api/public/{slug}): ask for exactly that, no probing.
  const lengths = maxDays < DAY_WINDOW ? [Math.max(1, maxDays)] : [DAY_WINDOW, 7, 3, 1];
  for (const length of lengths) {
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
      if (!outOfWindow || length === lengths[lengths.length - 1]) throw error;
    }
  }
  throw new ApiError(0, 'NETWORK', 'unreachable');
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
