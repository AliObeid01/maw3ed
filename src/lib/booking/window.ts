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
): Promise<SlotWindow> {
  const days = dayWindow(now, timezone, DAY_WINDOW);
  for (const length of [DAY_WINDOW, 7, 3, 1]) {
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
      if (!outOfWindow || length === 1) throw error;
    }
  }
  throw new ApiError(0, 'NETWORK', 'unreachable');
}
