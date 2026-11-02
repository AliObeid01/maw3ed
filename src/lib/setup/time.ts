import { DateTime } from 'luxon';
import { clockOf } from '@/lib/time/clock';

/** Value of an `<input type="datetime-local">`: `YYYY-MM-DDTHH:mm`, read as wall-clock time in `timezone`. */
const LOCAL_FORMAT = "yyyy-MM-dd'T'HH:mm";

export type LocalResolution =
  | { ok: true; iso: string }
  /** `invalid`: not a date and time at all. `nonexistent`: skipped by a spring-forward change in that zone. */
  | { ok: false; reason: 'invalid' | 'nonexistent' };

const DAY_MS = 86_400_000;

/**
 * Wall-clock time in the business timezone to a UTC instant (ISO, `Z`).
 *
 * - A time that does NOT exist (the hour skipped when clocks jump forward, e.g. 00:30 on the Beirut transition
 *   day) is rejected as `nonexistent`; Luxon would silently move it an hour forward.
 * - A time that happens TWICE (the repeated hour when clocks fall back) is accepted and resolves to its FIRST
 *   occurrence (the earlier instant, the one with the larger UTC offset).
 *
 * Works from the offsets either side of the wall time instead of Luxon's own guess, so it never depends on
 * Luxon's default locale or on the device's zone.
 */
export function resolveLocalToUtc(local: string, timezone: string): LocalResolution {
  const naive = DateTime.fromFormat(local, LOCAL_FORMAT, { zone: 'utc', locale: 'en' });
  if (!naive.isValid || !DateTime.fromMillis(0, { zone: timezone }).isValid) {
    return { ok: false, reason: 'invalid' };
  }
  const wall = naive.toMillis(); // the wall clock read as if it were UTC
  const offsetAt = (instant: number) => DateTime.fromMillis(instant, { zone: timezone }).offset;
  const offsets = new Set([offsetAt(wall - DAY_MS), offsetAt(wall + DAY_MS)]);
  const instants = [...offsets]
    .map((minutes) => wall - minutes * 60_000)
    .filter((instant) => offsetAt(instant) === (wall - instant) / 60_000)
    .sort((a, b) => a - b);
  const first = instants[0];
  if (first === undefined) return { ok: false, reason: 'nonexistent' };
  return {
    ok: true,
    iso: DateTime.fromMillis(first, { zone: 'utc' }).toISO({ suppressMilliseconds: true })!,
  };
}

/** `resolveLocalToUtc` for callers that only need the instant: null when invalid or nonexistent. */
export function localToUtcIso(local: string, timezone: string): string | null {
  const result = resolveLocalToUtc(local, timezone);
  return result.ok ? result.iso : null;
}

/** A zoned DateTime as the `datetime-local` value, through the shared clock formatter (locale independent). */
const toLocalValue = (dt: DateTime) => `${dt.toISODate()}T${clockOf(dt.hour, dt.minute)}`;

/** UTC instant to the `datetime-local` value as seen in the business timezone. */
export function utcIsoToLocal(iso: string, timezone: string): string {
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(timezone);
  return dt.isValid ? toLocalValue(dt) : '';
}

/**
 * Time off that starts at local midnight and ends at a later local midnight (or 23:59) is shown as "all day".
 */
export function isAllDay(startIso: string, endIso: string, timezone: string): boolean {
  const start = DateTime.fromISO(startIso, { zone: 'utc' }).setZone(timezone);
  const end = DateTime.fromISO(endIso, { zone: 'utc' }).setZone(timezone);
  if (!start.isValid || !end.isValid || end <= start) return false;
  const startsAtMidnight = start.hour === 0 && start.minute === 0;
  const endsAtMidnight = end.hour === 0 && end.minute === 0;
  const endsLate = end.hour === 23 && end.minute === 59;
  return startsAtMidnight && (endsAtMidnight || endsLate);
}

/** Last calendar day covered by an all-day range (end is exclusive at midnight, inclusive at 23:59). */
export function allDayLastDay(endIso: string, timezone: string): Date {
  const end = DateTime.fromISO(endIso, { zone: 'utc' }).setZone(timezone);
  const last = end.hour === 0 && end.minute === 0 ? end.minus({ days: 1 }) : end;
  return last.toJSDate();
}

/** Midnight (plus `plusDays`) in the zone as a `datetime-local` value: default for the time-off form. */
export function startOfDayLocal(now: Date, timezone: string, plusDays = 0): string {
  const dt = DateTime.fromJSDate(now, { zone: timezone }).startOf('day').plus({ days: plusDays });
  return dt.isValid ? toLocalValue(dt) : '';
}

/** Offset label such as `UTC+2` for a zone at a moment (timezone select options). */
export function utcOffsetLabel(timezone: string, at: Date): string {
  const dt = DateTime.fromJSDate(at, { zone: timezone });
  if (!dt.isValid) return '';
  const minutes = dt.offset;
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}
