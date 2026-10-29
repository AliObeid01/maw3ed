import { ApiError } from '@/lib/api/auth';
import { getSlots, type Slot } from '@/lib/api/booking';
import { DAY_WINDOW, dayWindow, groupSlotsByDay } from './slots';

export type SlotWindow = {
  /** Local days the server was asked about (a prefix of the 14-day window). */
  coveredDays: string[];
  byDay: Record<string, Slot[]>;
};

/**
 * Loads the free slots for the day strip in ONE request covering the next 14 local days. The public API does
 * not publish the business's booking window, so when the range is rejected as too far ahead (400 on `to`) the
 * request is retried with a shorter range (7, 3, then 1 day).
 */
export async function loadSlotWindow(
  slug: string,
  query: { serviceId: string; staffId?: string },
  timezone: string,
  now: Date,
  signal?: AbortSignal,
  fetchSlots: typeof getSlots = getSlots,
  /** Longest range to try first: pass the length discovered earlier so a short booking window is not re-probed. */
  maxDays: number = DAY_WINDOW,
): Promise<SlotWindow> {
  const days = dayWindow(now, timezone, DAY_WINDOW);
  const lengths = [DAY_WINDOW, 7, 3, 1].filter((n) => n <= Math.max(1, maxDays));
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

/** The window length discovered earlier in this browser session for a business (14 when unknown). */
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

/** Remember a window shorter than 14 days so the next load goes straight to it instead of probing again. */
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
