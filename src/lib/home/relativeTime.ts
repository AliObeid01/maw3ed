import { DateTime } from 'luxon';
import { dayLabel } from './freeTimes';

/** Under this many minutes the label counts down ("In 15 min"); under {@link HOURS_LIMIT} hours it counts hours. */
export const MINUTES_LIMIT = 60;
export const HOURS_LIMIT = 6;

export type RelativeLabel =
  | { kind: 'now' }
  | { kind: 'minutes'; count: number }
  | { kind: 'hours'; count: number }
  | { kind: 'today' }
  | { kind: 'tomorrow' }
  | { kind: 'date'; text: string };

/**
 * A short relative label for a free time, next to its clock time: "Now", "In 15 min", "In 3 h" (whole hours, rounded down, within 6 hours),
 * then today / tomorrow / "Mon 9 Nov" by the BUSINESS calendar. Pure: `now` is injected, the zone is the business's.
 */
export function relativeLabel(iso: string, timeZone: string, now: Date, locale: string): RelativeLabel {
  const start = DateTime.fromISO(iso);
  const diffMin = Math.ceil((start.toMillis() - now.getTime()) / 60_000);
  if (diffMin <= 0) return { kind: 'now' };
  if (diffMin < MINUTES_LIMIT) return { kind: 'minutes', count: diffMin };
  // Whole hours, rounded DOWN: 61 to 119 minutes is "In 1 h", never "In 2 h" (rounding up would promise a later time).
  const hours = Math.floor(diffMin / 60);
  if (diffMin < HOURS_LIMIT * 60) return { kind: 'hours', count: hours };
  const day = dayLabel(iso, timeZone, now, locale);
  return day.kind === 'date' ? { kind: 'date', text: day.text } : { kind: day.kind };
}

/** Sort by the soonest start, keeping the incoming order for ties (stable). */
export function bySoonest<T>(items: readonly T[], startOf: (item: T) => string | undefined): T[] {
  return items
    .map((item, index) => ({ item, index, at: startOf(item) ? Date.parse(startOf(item) as string) : Infinity }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map((x) => x.item);
}
