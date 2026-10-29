/** Pure working-hours validation. Times are "HH:mm" local strings; "24:00" is allowed as an end only. */
export interface HoursInterval {
  weekday: number;
  startLocal: string;
  endLocal: string;
}

export const MAX_INTERVALS_PER_DAY = 6;
export const MAX_INTERVALS_TOTAL = 42;

export interface HoursProblem {
  /** Index into the submitted array. */
  index: number;
  message: string;
}

/** Minutes since midnight. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/**
 * First problem found, or undefined. Checks end > start, no overlap within a weekday (touching
 * intervals such as 09:00-12:00 and 12:00-15:00 are fine), at most 6 per weekday.
 */
export function findHoursProblem(intervals: readonly HoursInterval[]): HoursProblem | undefined {
  for (const [index, i] of intervals.entries()) {
    if (toMinutes(i.endLocal) <= toMinutes(i.startLocal))
      return { index, message: 'End must be after start.' };
  }
  const byDay = new Map<number, { index: number; start: number; end: number }[]>();
  for (const [index, i] of intervals.entries()) {
    const list = byDay.get(i.weekday) ?? [];
    list.push({ index, start: toMinutes(i.startLocal), end: toMinutes(i.endLocal) });
    byDay.set(i.weekday, list);
  }
  for (const list of byDay.values()) {
    if (list.length > MAX_INTERVALS_PER_DAY)
      return {
        index: list[MAX_INTERVALS_PER_DAY]!.index,
        message: `At most ${MAX_INTERVALS_PER_DAY} intervals per day.`,
      };
    list.sort((a, b) => a.start - b.start || a.index - b.index);
    for (let k = 1; k < list.length; k++) {
      if (list[k]!.start < list[k - 1]!.end)
        return {
          index: Math.max(list[k]!.index, list[k - 1]!.index),
          message: 'Overlaps another interval on the same day.',
        };
    }
  }
  return undefined;
}

export function sortIntervals<T extends HoursInterval>(intervals: readonly T[]): T[] {
  return [...intervals].sort(
    (a, b) => a.weekday - b.weekday || toMinutes(a.startLocal) - toMinutes(b.startLocal),
  );
}
