import { DateTime } from 'luxon';

/** The server rejects a waitlist range longer than this many calendar days (inclusive). */
export const MAX_SPAN_DAYS = 31;
/** Default length of the range offered on the form (today and the next 13 days). */
export const DEFAULT_SPAN_DAYS = 14;

export type DateRange = { from: string; to: string };
export type RangeProblem = 'fromRequired' | 'toRequired' | 'fromPast' | 'toBeforeFrom' | 'tooLong';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (value: string) => YMD.test(value) && DateTime.fromISO(value, { zone: 'utc' }).isValid;

/** Calendar days between two local dates, counted in UTC so a DST change never shifts the count. */
function daysBetween(from: string, to: string): number {
  const a = DateTime.fromISO(from, { zone: 'utc' });
  const b = DateTime.fromISO(to, { zone: 'utc' });
  return Math.round(b.diff(a, 'days').days);
}

/** Local `yyyy-MM-dd` of "today" in the business timezone. */
export function todayIn(now: Date, timezone: string): string {
  return DateTime.fromJSDate(now, { zone: timezone }).toISODate()!;
}

/** `ymd` plus `days` calendar days (DST-safe: date arithmetic, not 24 h steps). */
export function addDays(ymd: string, days: number): string {
  return DateTime.fromISO(ymd, { zone: 'utc' }).plus({ days }).toISODate()!;
}

/**
 * Default range: today .. today + 13, clipped to the booking window when a shorter one was discovered
 * (`windowDays` is the length the slot loader found, 14 when unknown). Never shorter than today alone.
 */
export function defaultRange(now: Date, timezone: string, windowDays: number = DEFAULT_SPAN_DAYS): DateRange {
  const from = todayIn(now, timezone);
  const span = Math.min(DEFAULT_SPAN_DAYS, Math.max(1, Math.floor(windowDays)));
  return { from, to: addDays(from, span - 1) };
}

/**
 * Same rules the server applies to `fromDate` / `toDate` (except the booking window, which is the server's
 * to judge): both set, from >= today, to >= from, at most 31 days. Returns the problem per field.
 */
export function validateRange(
  range: { from: string; to: string },
  now: Date,
  timezone: string,
): { from?: RangeProblem; to?: RangeProblem } {
  const problems: { from?: RangeProblem; to?: RangeProblem } = {};
  if (!isDay(range.from)) problems.from = 'fromRequired';
  if (!isDay(range.to)) problems.to = 'toRequired';
  if (problems.from || problems.to) return problems;
  if (range.from < todayIn(now, timezone)) problems.from = 'fromPast';
  if (range.to < range.from) problems.to = 'toBeforeFrom';
  else if (daysBetween(range.from, range.to) + 1 > MAX_SPAN_DAYS) problems.to = 'tooLong';
  return problems;
}

/** When the start moves past the end, move the end along so the range never inverts silently. */
export function followStart(range: DateRange, nextFrom: string): DateRange {
  if (!isDay(nextFrom)) return { ...range, from: nextFrom };
  if (isDay(range.to) && range.to >= nextFrom) return { ...range, from: nextFrom };
  return { from: nextFrom, to: nextFrom };
}
