import { DateTime } from 'luxon';

/**
 * THE time-of-day formatter. Every screen, email and export that shows a time of day goes through here:
 * zero-padded 24-hour `HH:mm`, Latin digits in every language, always in the business timezone.
 *
 * It builds the string by hand from the zoned hour and minute, so it never depends on the ICU locale, the
 * server's or the device's zone, or Luxon's default locale (an Arabic device would otherwise get Arabic digits).
 * Pure: safe in server code, client code and tests.
 */

const two = (n: number) => String(n).padStart(2, '0');

/** `HH:mm` from a whole hour and minute (also the grid's hour labels: `clockOf(9, 0)` is `09:00`). */
export function clockOf(hour: number, minute = 0): string {
  return `${two(hour)}:${two(minute)}`;
}

/** An instant (ISO string, Date or epoch ms) as `HH:mm` on the wall clock of `timezone`. Empty when invalid. */
export function formatClock(instant: string | Date | number, timezone: string): string {
  const dt =
    typeof instant === 'string'
      ? DateTime.fromISO(instant, { zone: 'utc' })
      : typeof instant === 'number'
        ? DateTime.fromMillis(instant, { zone: 'utc' })
        : DateTime.fromJSDate(instant, { zone: 'utc' });
  const zoned = dt.setZone(timezone);
  return zoned.isValid ? clockOf(zoned.hour, zoned.minute) : '';
}

/** `yyyy-MM-dd HH:mm` on the business wall clock (exports). */
export function formatLocalStamp(instant: string | Date | number, timezone: string): string {
  const dt = DateTime.fromJSDate(new Date(instant), { zone: timezone });
  return dt.isValid ? `${dt.toISODate()} ${clockOf(dt.hour, dt.minute)}` : '';
}
