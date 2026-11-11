import { DateTime } from 'luxon';
import { addDaysYmd, clampYmd, isYmd } from '@/lib/pickers/monthGrid';

/**
 * Pure helpers for the Today header day picker. Days are plain `yyyy-MM-dd` strings in the BUSINESS time zone; all
 * arithmetic is on calendar dates in UTC (never 24 h steps), so DST days and the browser zone cannot move a day.
 */

/** Same sane bounds as the Today API contract. */
export const DAY_MIN = '2000-01-01';
export const DAY_MAX = '2100-12-31';

/** Whether the day is inside the allowed range (week chips outside it are disabled). */
export const inDayBounds = (ymd: string): boolean => ymd >= DAY_MIN && ymd <= DAY_MAX;

export const clampDay = (ymd: string): string => clampYmd(ymd, DAY_MIN, DAY_MAX);

export const shiftDayClamped = (ymd: string, delta: number): string => clampDay(addDaysYmd(ymd, delta));

/** "Today" as a date in the business zone. */
export function todayKey(timezone: string, now: Date): string {
  return DateTime.fromJSDate(now, { zone: timezone }).toISODate()!;
}

/**
 * The value to store as the viewed day: null means "follow the real today" (so a tab left open past midnight moves
 * on); invalid input also falls back to today; everything else is clamped into the bounds.
 */
export function normalizeDay(ymd: string, today: string): string | null {
  if (!isYmd(ymd)) return null;
  const day = clampDay(ymd);
  return day === today ? null : day;
}

export type DayShortcutId = 'yesterday' | 'tomorrow' | 'lastWeek' | 'nextWeek';

/** Quick jumps relative to the real today. */
export function dayShortcuts(today: string): { id: DayShortcutId; ymd: string }[] {
  return [
    { id: 'yesterday', ymd: shiftDayClamped(today, -1) },
    { id: 'tomorrow', ymd: shiftDayClamped(today, 1) },
    { id: 'lastWeek', ymd: shiftDayClamped(today, -7) },
    { id: 'nextWeek', ymd: shiftDayClamped(today, 7) },
  ];
}

/** The seven days (Monday first, like the month grid and the business views) of the week containing `ymd`. */
export function weekOf(ymd: string): string[] {
  const offset = DateTime.fromISO(ymd, { zone: 'utc' }).weekday - 1;
  return Array.from({ length: 7 }, (_, i) => addDaysYmd(ymd, i - offset));
}
