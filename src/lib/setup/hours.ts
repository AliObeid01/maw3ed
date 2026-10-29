import type { HoursInterval } from '@/lib/api/setup';

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
  return week.map(sortDay);
}

export function weekToApi(week: Week): HoursInterval[] {
  return week.flatMap((day, weekday) =>
    sortDay(day).map((i) => ({ weekday, startLocal: i.start, endLocal: i.end })),
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

/** `<input type="time">` cannot hold 24:00; an end of midnight means end of day. */
export const endToInput = (end: string) => (end === '24:00' ? '00:00' : end);
export const endFromInput = (value: string) => (value === '00:00' ? '24:00' : value);
