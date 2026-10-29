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

/** Pixel box of a block inside the staff column: time offset and duration scale linearly (44 px per 30 min). */
export function blockBox(
  appt: Pick<TodayAppointment, 'startAt' | 'endAt'>,
  timezone: string,
  startHour: number,
): { top: number; height: number; compact: boolean } {
  const offsetMin = minutesOfDay(appt.startAt, timezone) - startHour * 60;
  const durationMin = (Date.parse(appt.endAt) - Date.parse(appt.startAt)) / 60_000;
  const top = (offsetMin / ROW_MIN) * ROW_PX;
  const height = Math.max((durationMin / ROW_MIN) * ROW_PX, 24);
  // Under 30 minutes the block is shorter than a row: one line only. From 30 minutes it has room for two.
  return { top, height, compact: durationMin < ROW_MIN };
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
