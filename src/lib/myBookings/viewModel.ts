import { formatClock } from '@/lib/time/clock';
import type { SavedBooking } from './storage';

/**
 * Upcoming = starts after `now` (instants, so zones never matter) and not ended; the signed link stops working at
 * the start, so an appointment that has started is "previous". `pinned` keeps an entry the visitor is looking at
 * in Upcoming for this page view (a booking they just cancelled stays visible, as "Cancelled", until they leave).
 * Upcoming: soonest first. Previous: latest first.
 */
export function splitBookings(
  entries: readonly SavedBooking[],
  now: Date,
  pinned: ReadonlySet<string> = new Set(),
): { upcoming: SavedBooking[]; past: SavedBooking[] } {
  const upcoming: SavedBooking[] = [];
  const past: SavedBooking[] = [];
  for (const entry of entries) {
    const live = !entry.ended && Date.parse(entry.startAt) > now.getTime();
    (live || pinned.has(entry.token) ? upcoming : past).push(entry);
  }
  const start = (e: SavedBooking) => Date.parse(e.startAt);
  upcoming.sort((a, b) => start(a) - start(b));
  past.sort((a, b) => start(b) - start(a));
  return { upcoming, past };
}

const localeOf = (locale: string) => (locale === 'ar' ? 'ar-u-nu-latn' : 'en-GB-u-nu-latn');

/** Weekday and date ("Fri 6 Nov") and the 24-hour range ("10:30 – 11:00") on the BUSINESS wall clock, Latin digits. */
export function formatWhen(
  startAt: string,
  endAt: string,
  timezone: string,
  locale: string,
): { day: string; range: string; month: string; dayOfMonth: string } {
  let day = '';
  let month = '';
  let dayOfMonth = '';
  try {
    const tile = new Intl.DateTimeFormat(localeOf(locale), {
      timeZone: timezone,
      month: 'short',
      day: 'numeric',
      numberingSystem: 'latn',
    }).formatToParts(new Date(startAt));
    month = tile.find((p) => p.type === 'month')?.value ?? '';
    dayOfMonth = tile.find((p) => p.type === 'day')?.value ?? '';
    day = new Intl.DateTimeFormat(localeOf(locale), {
      timeZone: timezone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      numberingSystem: 'latn',
    })
      .format(new Date(startAt))
      .replace(/,/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    day = '';
  }
  return { day, month, dayOfMonth, range: `${formatClock(startAt, timezone)} – ${formatClock(endAt, timezone)}` };
}
