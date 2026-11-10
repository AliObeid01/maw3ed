import { DateTime } from 'luxon';
import type { WeeklyHours } from './manifest';
import type { Rng } from './rng';

/**
 * Pure appointment placement. Every instant is computed with Luxon in the business zone (never the server zone),
 * and appointments are placed BY CONSTRUCTION without overlap: a candidate is accepted only when its blocked range
 * [start, end + buffer) is free for that staff member. The database exclusion constraint is the judge.
 */

export const STEP_MS = 15 * 60_000;
const MIN_MS = 60_000;

export interface Interval {
  startMs: number;
  endMs: number;
}

/** Local weekday 0 (Sunday) .. 6 (Saturday) of a DateTime. */
export const weekdayOf = (d: DateTime): 0 | 1 | 2 | 3 | 4 | 5 | 6 => (d.weekday % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** The working intervals of one local day (a DateTime anywhere on that day), in epoch milliseconds. */
export function workingIntervals(day: DateTime, hours: WeeklyHours): Interval[] {
  const list = hours[weekdayOf(day)] ?? [];
  return list.map(([from, to]) => {
    const at = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number) as [number, number];
      return day.set({ hour: h, minute: m, second: 0, millisecond: 0 }).toMillis();
    };
    return { startMs: at(from), endMs: at(to) };
  });
}

export interface PlacedSlot {
  serviceIndex: number;
  startMs: number;
  endMs: number;
  /** end + service buffer: what the exclusion constraint blocks. */
  blockedMs: number;
}

export interface ServiceLoad {
  durationMin: number;
  bufferMin: number;
  weight: number;
}

/** Relative demand across the working day: a morning peak, a late-afternoon peak, a midday dip. */
export function demandWeight(t: number): number {
  const peak = (centre: number, width: number, height: number) =>
    height * Math.exp(-(((t - centre) / width) ** 2));
  return 0.35 + peak(0.15, 0.13, 1.0) + peak(0.86, 0.15, 1.1);
}

export interface PlaceTarget {
  /** Minutes to fill in the part of the day before `nowMs` / from `nowMs` on. */
  pastMinutes: number;
  futureMinutes: number;
}

/**
 * Fill one staff member's day. Candidates are drawn on the 15-minute grid, weighted by time of day, until the
 * target minutes (service + buffer) are reached or the attempts run out. The past part of the day (before now)
 * and the future part have separate targets, so today can be "busy so far" and "half free" at once.
 */
export function placeDay(
  rng: Rng,
  intervals: Interval[],
  services: ServiceLoad[],
  target: PlaceTarget,
  nowMs: number,
): PlacedSlot[] {
  if (intervals.length === 0 || services.length === 0) return [];
  const spanStart = intervals[0]!.startMs;
  const spanEnd = intervals[intervals.length - 1]!.endMs;
  const placed: PlacedSlot[] = [];
  let pastFilled = 0;
  let futureFilled = 0;
  const weights = services.map((s) => s.weight);
  const free = (start: number, blocked: number) =>
    placed.every((p) => blocked <= p.startMs || start >= p.blockedMs);

  for (let attempt = 0; attempt < 400; attempt++) {
    const pastDone = pastFilled >= target.pastMinutes;
    const futureDone = futureFilled >= target.futureMinutes;
    if (pastDone && futureDone) break;
    const serviceIndex = rng.weighted(weights);
    const svc = services[serviceIndex]!;
    const need = (svc.durationMin + svc.bufferMin) * MIN_MS;
    // Pick an interval proportional to its length, then a grid start inside it weighted by time of day.
    const iv = intervals[rng.weighted(intervals.map((i) => i.endMs - i.startMs))]!;
    const last = iv.endMs - need;
    if (last < iv.startMs) continue;
    const grid: number[] = [];
    for (let s = iv.startMs; s <= last; s += STEP_MS) grid.push(s);
    const start = grid[rng.weighted(grid.map((g) => demandWeight((g - spanStart) / (spanEnd - spanStart))))]!;
    const end = start + svc.durationMin * MIN_MS;
    const blocked = end + svc.bufferMin * MIN_MS;
    const isPast = blocked <= nowMs;
    // Accept only if the fill ends within half a block of the target (so tiny targets place nothing).
    const half = (blocked - start) / MIN_MS / 2;
    if (isPast && (pastDone || pastFilled + half > target.pastMinutes)) continue;
    if (!isPast && (futureDone || futureFilled + half > target.futureMinutes)) continue;
    if (!free(start, blocked)) continue;
    placed.push({ serviceIndex, startMs: start, endMs: end, blockedMs: blocked });
    if (isPast) pastFilled += (blocked - start) / MIN_MS;
    else futureFilled += (blocked - start) / MIN_MS;
  }
  return placed.sort((a, b) => a.startMs - b.startMs);
}

/** Minutes of the intervals that end at or before `nowMs`, and the rest. */
export function splitCapacity(intervals: Interval[], nowMs: number): { past: number; future: number } {
  let past = 0;
  let future = 0;
  for (const iv of intervals) {
    const total = (iv.endMs - iv.startMs) / MIN_MS;
    if (iv.endMs <= nowMs) past += total;
    else if (iv.startMs >= nowMs) future += total;
    else {
      past += (nowMs - iv.startMs) / MIN_MS;
      future += (iv.endMs - nowMs) / MIN_MS;
    }
  }
  return { past, future };
}
