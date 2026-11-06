import type { HoursInterval } from '@/lib/api/setup';
import { mergeDayIntervals } from './hoursMerge';

/** Weekday numbers follow the API: 0 = Sunday ... 6 = Saturday. Boards list Monday first. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
export const MAX_INTERVALS_PER_DAY = 6;

export type DayInterval = { start: string; end: string };
/** Index = weekday (0..6). */
export type Week = DayInterval[][];

export type DayProblem = 'invalid' | 'endBeforeStart' | 'overlap' | 'tooMany';

/** `HH:mm` (and `24:00`) to minutes since midnight; NaN when malformed. */
export function toMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return NaN;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (m > 59 || h > 24 || (h === 24 && m !== 0)) return NaN;
  return h * 60 + m;
}

export const emptyWeek = (): Week => Array.from({ length: 7 }, () => []);

export function sortDay(day: DayInterval[]): DayInterval[] {
  return [...day].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
}

export function weekFromApi(intervals: HoursInterval[]): Week {
  const week = emptyWeek();
  for (const i of intervals) week[i.weekday]?.push({ start: i.startLocal, end: i.endLocal });
  return mergeWeek(week);
}

/** Every day with touching / overlapping blocks merged into one (see hoursMerge.ts); days stay separate. */
export const mergeWeek = (week: Week): Week => week.map((day) => mergeDayIntervals(day));

export function weekToApi(week: Week): HoursInterval[] {
  return week.flatMap((day, weekday) =>
    mergeDayIntervals(day).map((i) => ({ weekday, startLocal: i.start, endLocal: i.end })),
  );
}

/** Problems for one day; an empty list means the day can be saved. Touching intervals (13:00 / 13:00) are fine. */
export function validateDay(day: DayInterval[]): DayProblem[] {
  const problems = new Set<DayProblem>();
  if (day.length > MAX_INTERVALS_PER_DAY) problems.add('tooMany');
  const parsed = day.map((i) => ({ s: toMinutes(i.start), e: toMinutes(i.end) }));
  for (const { s, e } of parsed) {
    if (Number.isNaN(s) || Number.isNaN(e)) problems.add('invalid');
    else if (e <= s) problems.add('endBeforeStart');
  }
  const valid = parsed.filter((p) => !Number.isNaN(p.s) && !Number.isNaN(p.e) && p.e > p.s);
  valid.sort((a, b) => a.s - b.s);
  for (let i = 1; i < valid.length; i++) {
    if (valid[i]!.s < valid[i - 1]!.e) problems.add('overlap');
  }
  return [...problems];
}

/** Problems per weekday (only days with problems are present). */
export function validateWeek(week: Week): Partial<Record<number, DayProblem[]>> {
  const out: Partial<Record<number, DayProblem[]>> = {};
  week.forEach((day, weekday) => {
    const problems = validateDay(day);
    if (problems.length) out[weekday] = problems;
  });
  return out;
}

/** Copy one day's intervals onto the target days (replacing them). Returns a new week. */
export function copyDay(week: Week, from: number, targets: readonly number[]): Week {
  const source = week[from] ?? [];
  return week.map((day, weekday) =>
    targets.includes(weekday) && weekday !== from ? source.map((i) => ({ ...i })) : day,
  );
}

const fmt = (n: number) =>
  n >= 1440
    ? '24:00'
    : `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

/** Next interval to suggest when adding to a day: an hour after the last end, or 09:00-17:00 on an empty day. */
export function suggestInterval(day: DayInterval[]): DayInterval {
  if (day.length === 0) return { start: '09:00', end: '17:00' };
  const ends = day.map((i) => toMinutes(i.end)).filter((n) => !Number.isNaN(n));
  const lastEnd = Math.max(0, ...ends);
  const start = Math.min(lastEnd + 60, 22 * 60);
  return { start: fmt(start), end: fmt(Math.min(start + 4 * 60, 24 * 60)) };
}

/** Hours-select value for end of day. Stored as "24:00"; the Closes list offers it explicitly. */
export const END_OF_DAY = '24:00';

/** An old value or hand-typed `00:00` used as an end meant end of day: read it as 24:00. */
export const endFromInput = (value: string) => (value === '00:00' ? END_OF_DAY : value);

/** Weekday after `weekday` (0 = Sunday ... 6 = Saturday); Saturday continues into Sunday. */
export const nextWeekday = (weekday: number) => (weekday + 1) % 7;

const sameInterval = (a: DayInterval, b: DayInterval) => a.start === b.start && a.end === b.end;

/**
 * Index of the first valid entry that closes earlier than it opens (09:00 to 02:00), the "open past midnight"
 * case; -1 when there is none. An equal start and end is a plain error, not a night shift.
 */
export function overnightIndex(day: DayInterval[]): number {
  return day.findIndex((i) => {
    const s = toMinutes(i.start);
    const e = toMinutes(i.end);
    return !Number.isNaN(s) && !Number.isNaN(e) && e < s;
  });
}

/** Add one interval to a day: sorted, exact duplicates dropped, overlapping entries unioned (touching ones stay apart). */
export function mergeDay(day: DayInterval[], add: DayInterval): DayInterval[] {
  const sorted = sortDay([...day.filter((i) => !sameInterval(i, add)), add]);
  const out: DayInterval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && toMinutes(cur.start) < toMinutes(last.end)) {
      if (toMinutes(cur.end) > toMinutes(last.end)) last.end = cur.end;
    } else out.push({ ...cur });
  }
  return out;
}

export type PastMidnightResult =
  | { ok: true; week: Week }
  | { ok: false; problem: 'tooMany' | 'overlap'; weekday: number };

/**
 * "Open until 02:00 the next day": entry `index` of `draft` (09:00 to 02:00) becomes 09:00 to 24:00 on `weekday` and
 * a 00:00 to 02:00 tail on the next weekday (Sunday continues into Monday), merged with what is already there.
 * With `copyTo`, those days get the same split day and each gets its own tail on its own next day. Local wall times,
 * so DST plays no part. Pure; returns a new week or the first problem (the input week is never changed).
 */
export function openPastMidnight(
  week: Week,
  weekday: number,
  draft: DayInterval[],
  index: number,
  copyTo: readonly number[] = [],
): PastMidnightResult {
  const target = draft[index];
  if (!target) return { ok: false, problem: 'overlap', weekday };
  const tailEnd = target.end;
  const split = sortDay(draft.map((i, k) => (k === index ? { start: i.start, end: END_OF_DAY } : { ...i })));
  if (validateDay(split).length > 0) {
    return { ok: false, problem: split.length > MAX_INTERVALS_PER_DAY ? 'tooMany' : 'overlap', weekday };
  }
  const days = new Set<number>([weekday, ...copyTo.filter((d) => d !== weekday)]);
  // 1. the split day replaces this day and every copy target; 2. each of them adds its tail to its own next day.
  let next: Week = week.map((day, d) => (days.has(d) ? split.map((i) => ({ ...i })) : day.map((i) => ({ ...i }))));
  for (const d of [...days].sort((a, b) => a - b)) {
    const n = nextWeekday(d);
    const merged = mergeDay(next[n]!, { start: '00:00', end: tailEnd });
    if (merged.length > MAX_INTERVALS_PER_DAY) return { ok: false, problem: 'tooMany', weekday: n };
    next = next.map((day, k) => (k === n ? merged : day));
  }
  return { ok: true, week: next };
}

/** True when the day starts at 00:00 and the day before closes at 24:00: its first entry is the end of last night's shift. */
export function continuesFromPrevious(week: Week, weekday: number): boolean {
  const first = sortDay(week[weekday] ?? [])[0];
  if (!first || first.start !== '00:00') return false;
  const prev = week[(weekday + 6) % 7] ?? [];
  return prev.some((i) => i.end === END_OF_DAY);
}
