import { DateTime } from 'luxon';
import { localToUtcMs } from './slots';

export const MAX_SLOT_RANGE_DAYS = 31;
export const MAX_APPOINTMENT_RANGE_DAYS = 62;

export type RangeFields = Record<string, string>;

export type LocalRange =
  | { ok: true; from: string; to: string; days: number; startUtc: Date; endUtc: Date }
  | { ok: false; fields: RangeFields };

/** True for a real calendar date written 'yyyy-MM-dd'. */
export function isLocalDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && DateTime.fromISO(value, { zone: 'utc' }).isValid;
}

function startOfLocalDayMs(date: string, zone: string): number {
  const d = DateTime.fromISO(date, { zone: 'utc' });
  return localToUtcMs({ year: d.year, month: d.month, day: d.day }, 0, 0, zone);
}

/**
 * Validates an inclusive range of local dates in `timezone` and converts it to a UTC half-open interval
 * [startUtc, endUtc). Pure: `now` is injected. `bookingWindowDays` (optional) rejects `to` beyond the window.
 */
export function resolveLocalRange(input: {
  from: string;
  to: string;
  timezone: string;
  maxDays: number;
  now: Date;
  bookingWindowDays?: number;
}): LocalRange {
  const fields: RangeFields = {};
  if (!isLocalDate(input.from)) fields.from = 'Use a date like 2026-11-10.';
  if (!isLocalDate(input.to)) fields.to = 'Use a date like 2026-11-10.';
  if (Object.keys(fields).length) return { ok: false, fields };

  const first = DateTime.fromISO(input.from, { zone: 'utc' });
  const last = DateTime.fromISO(input.to, { zone: 'utc' });
  const days = Math.round(last.diff(first, 'days').days) + 1;
  if (days < 1)
    return { ok: false, fields: { to: 'The end date must not be before the start date.' } };
  if (days > input.maxDays)
    return { ok: false, fields: { to: `The range is at most ${input.maxDays} days.` } };
  if (input.bookingWindowDays !== undefined) {
    const today = DateTime.fromMillis(input.now.getTime(), { zone: input.timezone });
    const limit = DateTime.fromObject(
      { year: today.year, month: today.month, day: today.day },
      { zone: 'utc' },
    ).plus({ days: input.bookingWindowDays });
    if (last > limit)
      return {
        ok: false,
        fields: { to: `Bookings open up to ${input.bookingWindowDays} days ahead.` },
      };
  }
  return {
    ok: true,
    from: input.from,
    to: input.to,
    days,
    startUtc: new Date(startOfLocalDayMs(input.from, input.timezone)),
    endUtc: new Date(startOfLocalDayMs(last.plus({ days: 1 }).toISODate()!, input.timezone)),
  };
}

/** The local calendar day containing `instant`: its 'yyyy-MM-dd' and UTC bounds [startUtc, endUtc). */
export function localDayOf(instant: Date, timezone: string) {
  const date = DateTime.fromMillis(instant.getTime(), { zone: timezone }).toISODate()!;
  const next = DateTime.fromISO(date, { zone: 'utc' }).plus({ days: 1 }).toISODate()!;
  return {
    date,
    startUtc: new Date(startOfLocalDayMs(date, timezone)),
    endUtc: new Date(startOfLocalDayMs(next, timezone)),
  };
}
