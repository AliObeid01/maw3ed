import { DateTime } from 'luxon';

/**
 * Pilot metrics (PILOT_PLAYBOOK). Pure: the clock and the timezone are injected, rates are percentages
 * (0-100) and NOT rounded here; the API edge rounds once with `round1`.
 *
 * Definitions
 * - A no-show: the client neither came nor cancelled before the cutoff.
 * - Rate = no-shows / (attended + no-shows). Late cancels are counted separately, and any cancellation
 *   (via link or by staff) is excluded from the denominator.
 * - `appointments` counts appointments that have started and were not cancelled in time (status CANCELLED
 *   is excluded; LATE_CANCEL, ATTENDED, NO_SHOW and still-unmarked past ones are included).
 * - The baseline rate is the owner's own figure: baseline no-shows / baseline appointments.
 */

export const round1 = (n: number): number => Math.round(n * 10) / 10;

export interface ReportRow {
  startAt: Date;
  status: string;
  cancelledVia: 'LINK' | 'STAFF' | 'SYSTEM' | null;
  source: string;
}

export interface Counts {
  appointments: number;
  attended: number;
  noShows: number;
  lateCancels: number;
}

export const emptyCounts = (): Counts => ({
  appointments: 0,
  attended: 0,
  noShows: 0,
  lateCancels: 0,
});

/** Percentage, or null when there is nothing to divide by. */
export function noShowRate(attended: number, noShows: number): number | null {
  const denominator = attended + noShows;
  return denominator === 0 ? null : (noShows / denominator) * 100;
}

export function baselineRate(appointments: number, noShows: number): number | null {
  return appointments === 0 ? null : (noShows / appointments) * 100;
}

/** Change in percentage points, and relative change in percent (null when the baseline rate is 0 or unknown). */
export function changeVsBaseline(pilot: number | null, baseline: number | null) {
  if (pilot === null || baseline === null) return { changePoints: null, changeRelativePct: null };
  return {
    changePoints: pilot - baseline,
    changeRelativePct: baseline === 0 ? null : ((pilot - baseline) / baseline) * 100,
  };
}

export function addRow(counts: Counts, row: Pick<ReportRow, 'status'>): void {
  if (row.status === 'CANCELLED') return;
  counts.appointments += 1;
  if (row.status === 'ATTENDED') counts.attended += 1;
  else if (row.status === 'NO_SHOW') counts.noShows += 1;
  else if (row.status === 'LATE_CANCEL') counts.lateCancels += 1;
}

export interface WeekWindow {
  /** Monday, 'yyyy-MM-dd' in the business timezone. */
  weekStart: string;
  startUtc: Date;
  endUtc: Date;
}

/** The local Monday at 00:00 of the week containing `instant`, as a Luxon DateTime in `timezone`. */
function mondayOf(instant: Date, timezone: string): DateTime {
  return DateTime.fromMillis(instant.getTime(), { zone: timezone }).startOf('week');
}

/** `weeks` consecutive local Monday-to-Monday windows ending with the week that contains `now`, oldest first. */
export function weekWindows(now: Date, timezone: string, weeks: number): WeekWindow[] {
  const current = mondayOf(now, timezone);
  const out: WeekWindow[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = current.minus({ weeks: i });
    const end = start.plus({ weeks: 1 });
    out.push({
      weekStart: start.toISODate()!,
      startUtc: new Date(start.toMillis()),
      endUtc: new Date(end.toMillis()),
    });
  }
  return out;
}

export function weeklyCounts(rows: ReportRow[], windows: WeekWindow[]) {
  return windows.map((w) => {
    const counts = emptyCounts();
    for (const r of rows) if (r.startAt >= w.startUtc && r.startAt < w.endUtc) addRow(counts, r);
    return {
      weekStart: w.weekStart,
      ...counts,
      noShowRate: noShowRate(counts.attended, counts.noShows),
    };
  });
}

/** Local calendar date 'yyyy-MM-dd' of an instant. */
export const localDateOf = (instant: Date, timezone: string): string =>
  DateTime.fromMillis(instant.getTime(), { zone: timezone }).toISODate()!;

/** Whole local days from `from` to `to` inclusive (both 'yyyy-MM-dd'). */
export function daysCovered(from: string, to: string): number {
  const a = DateTime.fromISO(from, { zone: 'utc' });
  const b = DateTime.fromISO(to, { zone: 'utc' });
  return Math.max(0, Math.round(b.diff(a, 'days').days) + 1);
}

export const MAX_BASELINE_DAYS = 31;

export interface BaselineInput {
  fromDate: string;
  toDate: string;
  appointments: number;
  noShows: number;
  lateCancels: number;
}

/** Field errors for an owner-entered baseline. `today` is the business-local 'yyyy-MM-dd' (injected). */
export function validateBaseline(input: BaselineInput, today: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const from = DateTime.fromISO(input.fromDate, { zone: 'utc' });
  const to = DateTime.fromISO(input.toDate, { zone: 'utc' });
  if (!from.isValid) fields.fromDate = 'Use a real date like 2026-10-01.';
  if (!to.isValid) fields.toDate = 'Use a real date like 2026-10-31.';
  if (from.isValid && to.isValid) {
    if (input.toDate < input.fromDate)
      fields.toDate = 'The end date must not be before the start date.';
    else if (daysCovered(input.fromDate, input.toDate) > MAX_BASELINE_DAYS)
      fields.toDate = `The baseline period is at most ${MAX_BASELINE_DAYS} days.`;
  }
  if (to.isValid && input.toDate > today)
    fields.toDate = 'The baseline period cannot end in the future.';
  if (input.noShows > input.appointments) fields.noShows = 'No-shows cannot exceed appointments.';
  return fields;
}
