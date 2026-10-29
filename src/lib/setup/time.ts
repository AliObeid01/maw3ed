import { DateTime } from 'luxon';

/** Value of an `<input type="datetime-local">`: `YYYY-MM-DDTHH:mm`, read as wall-clock time in `timezone`. */
const LOCAL_FORMAT = "yyyy-MM-dd'T'HH:mm";

/** Wall-clock time in the business timezone to a UTC instant (ISO, `Z`). Returns null when invalid. */
export function localToUtcIso(local: string, timezone: string): string | null {
  const dt = DateTime.fromFormat(local, LOCAL_FORMAT, { zone: timezone });
  if (!dt.isValid) return null;
  return dt.toUTC().toISO({ suppressMilliseconds: true });
}

/** UTC instant to the `datetime-local` value as seen in the business timezone. */
export function utcIsoToLocal(iso: string, timezone: string): string {
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(timezone);
  return dt.isValid ? dt.toFormat(LOCAL_FORMAT) : '';
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
  return DateTime.fromJSDate(now, { zone: timezone })
    .startOf('day')
    .plus({ days: plusDays })
    .toFormat(LOCAL_FORMAT);
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
