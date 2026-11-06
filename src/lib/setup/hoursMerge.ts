/**
 * Pure merge of working-hours blocks, shared by the Hours editor (client) and the hours service (server). No I/O,
 * no Date.
 *
 * Why: the slot engine fits a service plus its buffer inside ONE free interval, so 09:00-17:00 followed by
 * 17:00-22:00 are two blocks and a 60 min service cannot start at 16:30 (it would cross 17:00). Merging blocks that
 * touch or overlap on the SAME weekday makes them one block. A real break (12:00-13:00 free) stays two blocks.
 *
 * Limit: blocks on DIFFERENT days are never merged (Monday 09:00-24:00 and Tuesday 00:00-02:00 are the midnight
 * split of a late shift and stay as they are); a booking cannot cross midnight.
 */

type Block = { start: string; end: string };

const minutes = (value: string): number => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return NaN;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (m > 59 || h > 24 || (h === 24 && m !== 0)) return NaN;
  return h * 60 + m;
};

/**
 * One day's blocks: sorted by start, touching (end == next start) and overlapping blocks unioned. Never returns more
 * blocks than it was given, so the per-day maximum still holds. Entries that are not valid `HH:mm` are kept as they
 * are (validation reports them); a new array of new objects is returned and the input is not changed. Idempotent.
 */
export function mergeDayIntervals<T extends Block>(day: readonly T[]): T[] {
  const valid: { block: T; s: number; e: number }[] = [];
  const keep: T[] = [];
  for (const block of day) {
    const s = minutes(block.start);
    const e = minutes(block.end);
    if (Number.isNaN(s) || Number.isNaN(e) || e <= s) keep.push({ ...block });
    else valid.push({ block, s, e });
  }
  valid.sort((a, b) => a.s - b.s || a.e - b.e);
  const merged: { block: T; s: number; e: number }[] = [];
  for (const cur of valid) {
    const last = merged[merged.length - 1];
    if (last && cur.s <= last.e) {
      if (cur.e > last.e) {
        last.e = cur.e;
        last.block = { ...last.block, end: cur.block.end };
      }
    } else merged.push({ block: { ...cur.block }, s: cur.s, e: cur.e });
  }
  return [...merged.map((m) => m.block), ...keep];
}

export interface WeeklyBlock {
  weekday: number;
  startLocal: string;
  endLocal: string;
}

/** API shape: merge per weekday (never across days); output sorted by weekday then start. Idempotent. */
export function mergeWeekIntervals<T extends WeeklyBlock>(intervals: readonly T[]): T[] {
  const byDay = new Map<number, T[]>();
  for (const i of intervals) byDay.set(i.weekday, [...(byDay.get(i.weekday) ?? []), i]);
  return [...byDay.keys()]
    .sort((a, b) => a - b)
    .flatMap((weekday) =>
      mergeDayIntervals(
        byDay.get(weekday)!.map((i) => ({ ...i, start: i.startLocal, end: i.endLocal })),
      ).map(({ start, end, ...rest }) => ({ ...rest, startLocal: start, endLocal: end }) as unknown as T),
    );
}
