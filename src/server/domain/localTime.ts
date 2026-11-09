import { DateTime } from 'luxon';

/** ISO 8601 with the business zone's offset, e.g. 2026-11-11T18:30:00+02:00. Never the server's zone. */
export function toLocalIso(instant: Date, timezone: string): string {
  return DateTime.fromMillis(instant.getTime(), { zone: timezone }).toISO({
    suppressMilliseconds: true,
  })!;
}

/** English label with Latin digits in the business zone, e.g. "Wed 11 Nov, 18:30". */
export function localLabel(instant: Date, timezone: string): string {
  return DateTime.fromMillis(instant.getTime(), { zone: timezone })
    .setLocale('en')
    .toFormat('ccc d LLL, HH:mm');
}

/** Today's date (yyyy-MM-dd) in the business zone. */
export function localToday(now: Date, timezone: string): string {
  return DateTime.fromMillis(now.getTime(), { zone: timezone }).toISODate()!;
}

/** `date` plus `days` calendar days (both yyyy-MM-dd; calendar arithmetic, so DST never shifts the date). */
export function addLocalDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: 'utc' }).plus({ days }).toISODate()!;
}

/** True for a real calendar date written yyyy-MM-dd. */
export function isRealDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && DateTime.fromISO(date, { zone: 'utc' }).isValid;
}
