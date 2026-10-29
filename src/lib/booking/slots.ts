import { DateTime } from 'luxon';
import type { Slot } from '@/lib/api/booking';

/** Days shown in the day strip (one slots request covers them all). */
export const DAY_WINDOW = 14;
/** Days per page of the strip. */
export const STRIP_PAGE = 7;

/** `yyyy-MM-dd` of each calendar day starting at "today" in `timezone` (DST-safe: calendar days, not 24 h steps). */
export function dayWindow(now: Date, timezone: string, days = DAY_WINDOW): string[] {
  const start = DateTime.fromJSDate(now, { zone: timezone }).startOf('day');
  return Array.from({ length: days }, (_, i) => start.plus({ days: i }).toISODate()!);
}

/** Local `yyyy-MM-dd` of an instant in the business timezone. */
export function localDay(startAt: string, timezone: string): string {
  return DateTime.fromISO(startAt, { zone: 'utc' }).setZone(timezone).toISODate()!;
}

/** Local `HH:mm` of an instant in the business timezone. */
export function localTime(startAt: string, timezone: string): string {
  return DateTime.fromISO(startAt, { zone: 'utc' }).setZone(timezone).toFormat('HH:mm');
}

/** Slots grouped by their local day in the business timezone, each day sorted by start time. */
export function groupSlotsByDay(slots: Slot[], timezone: string): Record<string, Slot[]> {
  const byDay: Record<string, Slot[]> = {};
  for (const slot of slots) (byDay[localDay(slot.startAt, timezone)] ??= []).push(slot);
  for (const list of Object.values(byDay))
    list.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  return byDay;
}

/** Replaces one whole local day with the slots from a 409 payload (which covers that day), leaving other days alone. */
export function replaceDay(
  byDay: Record<string, Slot[]>,
  day: string,
  fresh: Slot[],
  timezone: string,
): Record<string, Slot[]> {
  const next = { ...byDay };
  const grouped = groupSlotsByDay(fresh, timezone);
  next[day] = grouped[day] ?? [];
  return next;
}

export type DayPart = 'morning' | 'afternoon' | 'evening';

/** Morning before 12:00, afternoon until 17:00, evening after. */
export function dayPart(startAt: string, timezone: string): DayPart {
  const hour = DateTime.fromISO(startAt, { zone: 'utc' }).setZone(timezone).hour;
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

export function partitionByDayPart(
  slots: Slot[],
  timezone: string,
): { part: DayPart; slots: Slot[] }[] {
  const parts: DayPart[] = ['morning', 'afternoon', 'evening'];
  return parts
    .map((part) => ({ part, slots: slots.filter((s) => dayPart(s.startAt, timezone) === part) }))
    .filter((group) => group.slots.length > 0);
}

/** The slot starting at local `HH:mm` (the first one if a DST fall-back repeats the hour). */
export function findSlotByLocalTime(slots: Slot[], timezone: string, time: string) {
  return slots.find((s) => localTime(s.startAt, timezone) === time);
}

/** First local day of the window that has a slot (to open the strip on something bookable). */
export function firstDayWithSlots(days: string[], byDay: Record<string, Slot[]>) {
  return days.find((d) => (byDay[d]?.length ?? 0) > 0);
}

/** Do the viewer's device and the business use different UTC offsets right now? Then the page shows a timezone note. */
export function timezonesDiffer(now: Date, businessZone: string, deviceZone: string): boolean {
  if (businessZone === deviceZone) return false;
  const at = DateTime.fromJSDate(now);
  return at.setZone(businessZone).offset !== at.setZone(deviceZone).offset;
}
