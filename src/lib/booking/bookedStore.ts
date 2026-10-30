import { z } from 'zod';
import { bookingResultSchema, type BookingResult } from '@/lib/api/booking';

/**
 * Keeps the confirmation screen across a refresh (F17). sessionStorage is per tab, same-origin and gone when
 * the tab closes; nothing is sent anywhere. The manage link inside is a bearer secret, so it is never put
 * in a URL, a cookie or a log, and the entry is dropped as soon as the appointment has started (when the
 * link itself stops working) or the visitor books again.
 */
export type BookedState = { result: BookingResult; name: string; hasEmail: boolean };

const stored = z.object({
  result: bookingResultSchema,
  name: z.string(),
  hasEmail: z.boolean(),
});

const key = (slug: string) => `maw3ed:booked:${slug}`;
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const browserStore = (): Store | undefined => {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
};

export function saveBooked(slug: string, state: BookedState, storage: Store | undefined = browserStore()) {
  try {
    storage?.setItem(key(slug), JSON.stringify(state));
  } catch {
    // Storage full or disabled (private mode): the confirmation email still has the link.
  }
}

export function clearBooked(slug: string, storage: Store | undefined = browserStore()) {
  try {
    storage?.removeItem(key(slug));
  } catch {
    // nothing to do
  }
}

/** The saved confirmation, or undefined when absent, malformed, or the appointment has already started. */
export function loadBooked(
  slug: string,
  now: Date,
  storage: Store | undefined = browserStore(),
): BookedState | undefined {
  try {
    const raw = storage?.getItem(key(slug));
    if (!raw) return undefined;
    const parsed = stored.safeParse(JSON.parse(raw));
    if (!parsed.success || Date.parse(parsed.data.result.appointment.startAt) <= now.getTime()) {
      storage?.removeItem(key(slug));
      return undefined;
    }
    return parsed.data;
  } catch {
    return undefined;
  }
}
