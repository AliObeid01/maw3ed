import { DateTime } from 'luxon';
import type { TodayAppointment } from '@/lib/api/dashboard';
import { isActive } from './agenda';

/** Height of one 30-minute row on the calendar grid (board 22). */
export const ROW_PX = 44;
export const ROW_MIN = 30;
export const DEFAULT_RANGE = { startHour: 9, endHour: 17 } as const;

const minutesOfDay = (iso: string, timezone: string) => {
  const t = DateTime.fromISO(iso, { zone: 'utc' }).setZone(timezone);
  return t.hour * 60 + t.minute;
};

/**
 * Whole hours the grid covers: from the earliest start to the latest end seen in the data (rounded out to full
 * hours), 9-17 when the day is empty. A booking running past midnight is clipped to 24:00.
 */
export function calendarRange(
  appointments: TodayAppointment[],
  timezone: string,
): { startHour: number; endHour: number } {
  const active = appointments.filter(isActive);
  if (active.length === 0) return { ...DEFAULT_RANGE };
  let start = Infinity;
  let end = -Infinity;
  for (const a of active) {
    const s = minutesOfDay(a.startAt, timezone);
    const durationMin = (Date.parse(a.endAt) - Date.parse(a.startAt)) / 60_000;
    start = Math.min(start, s);
    end = Math.max(end, Math.min(s + durationMin, 24 * 60));
  }
  return { startHour: Math.floor(start / 60), endHour: Math.max(Math.ceil(end / 60), Math.floor(start / 60) + 1) };
}

/**
 * Shortest a block is drawn, in px (the wrapper leaves 2 px above and below, so about 32 px is visible). A 15 minute
 * appointment is only 22 px by time; this keeps its client and time readable. Blocks that would then collide are
 * placed side by side by `layoutColumn`.
 */
export const MIN_BLOCK_PX = 36;
/** Below this the block has room for one line only (client name + time). */
export const ONE_LINE_PX = 52;

/** Pixel box of a block inside the staff column: time offset and duration scale linearly (44 px per 30 min). */
export function blockBox(
  appt: Pick<TodayAppointment, 'startAt' | 'endAt'>,
  timezone: string,
  startHour: number,
): { top: number; height: number; compact: boolean } {
  const offsetMin = minutesOfDay(appt.startAt, timezone) - startHour * 60;
  const durationMin = (Date.parse(appt.endAt) - Date.parse(appt.startAt)) / 60_000;
  const top = (offsetMin / ROW_MIN) * ROW_PX;
  const height = Math.max((durationMin / ROW_MIN) * ROW_PX, MIN_BLOCK_PX);
  return { top, height, compact: height < ONE_LINE_PX };
}

export type PlacedBlock<T> = {
  item: T;
  top: number;
  height: number;
  compact: boolean;
  /** 0-based lane inside the cluster of blocks that collide on screen. */
  lane: number;
  /** How many lanes that cluster has (1 when the block stands alone). */
  lanes: number;
};

/**
 * Places one person's blocks. Blocks whose drawn boxes (not just their times) collide share the column side by side
 * instead of covering each other: two real overlaps, or two short appointments back to back whose minimum height
 * reaches into the next one. Lanes are assigned greedily, which is optimal for intervals; every block of a cluster
 * gets the cluster's lane count so they all have the same width.
 */
export function layoutColumn<T extends Pick<TodayAppointment, 'startAt' | 'endAt'>>(
  items: T[],
  timezone: string,
  startHour: number,
): PlacedBlock<T>[] {
  const boxes = items
    .map((item) => ({ item, ...blockBox(item, timezone, startHour) }))
    .sort((x, y) => x.top - y.top || y.height - x.height);
  const placed: PlacedBlock<T>[] = [];
  let cluster: PlacedBlock<T>[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    for (const block of cluster) block.lanes = laneEnds.length;
    placed.push(...cluster);
    cluster = [];
    laneEnds = [];
    clusterEnd = -Infinity;
  };
  for (const box of boxes) {
    if (box.top >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= box.top);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = box.top + box.height;
    clusterEnd = Math.max(clusterEnd, box.top + box.height);
    cluster.push({ ...box, lane, lanes: 1 });
  }
  flush();
  return placed;
}

/** Grid rows (1-based, after a 48 px header row) that a block starts on and spans, rounded out to whole 30-min rows. */
export function blockRows(
  appt: Pick<TodayAppointment, 'startAt' | 'endAt'>,
  timezone: string,
  startHour: number,
): { rowStart: number; rowSpan: number } {
  const offsetMin = minutesOfDay(appt.startAt, timezone) - startHour * 60;
  const durationMin = (Date.parse(appt.endAt) - Date.parse(appt.startAt)) / 60_000;
  const first = Math.floor(offsetMin / ROW_MIN);
  const last = Math.ceil((offsetMin + durationMin) / ROW_MIN);
  return { rowStart: first + 1, rowSpan: Math.max(1, last - first) };
}

/** Hour labels down the time column. */
export const hourMarks = (range: { startHour: number; endHour: number }): number[] =>
  Array.from({ length: range.endHour - range.startHour }, (_, i) => range.startHour + i);
