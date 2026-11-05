import { DateTime } from 'luxon';

/**
 * Pure calendar maths for the date picker. Every value is a plain `yyyy-MM-dd` string; Luxon is only used in UTC to
 * count days, so the browser's time zone can never shift a date (no `new Date()` local-zone bugs).
 */

export const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 1 = Monday (ISO) ... 7 = Sunday. The business views list Monday first. */
export type WeekStart = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type DayCell = {
  ymd: string;
  day: number;
  /** False for the leading and trailing days of the neighbouring months. */
  inMonth: boolean;
  disabled: boolean;
};

const utc = (ymd: string) => DateTime.fromISO(ymd, { zone: 'utc' });

export function isYmd(value: string | undefined | null): value is string {
  return Boolean(value && YMD.test(value) && utc(value).isValid);
}

export function ymdOf(dt: DateTime): string {
  return dt.toFormat('yyyy-MM-dd');
}

export function addDaysYmd(ymd: string, days: number): string {
  return ymdOf(utc(ymd).plus({ days }));
}

/** Moves by whole months and clamps the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsYmd(ymd: string, months: number): string {
  return ymdOf(utc(ymd).plus({ months }));
}

export function monthStart(ymd: string): string {
  return ymdOf(utc(ymd).startOf('month'));
}

export function isDisabledYmd(ymd: string, min?: string, max?: string): boolean {
  if (min && isYmd(min) && ymd < min) return true;
  if (max && isYmd(max) && ymd > max) return true;
  return false;
}

/** Nearest allowed day to `ymd` (the picker never focuses or selects a day outside min/max). */
export function clampYmd(ymd: string, min?: string, max?: string): string {
  if (min && isYmd(min) && ymd < min) return min;
  if (max && isYmd(max) && ymd > max) return max;
  return ymd;
}

/**
 * The weeks of a month as rows of 7 cells, starting on `weekStart`. 4, 5 or 6 rows depending on the month (a 28-day
 * February that starts on the first weekday of a week fits in 4). Days outside the month fill the first and last row.
 */
export function monthMatrix(
  year: number,
  month: number,
  opts: { weekStart?: WeekStart; min?: string; max?: string } = {},
): DayCell[][] {
  const weekStart = opts.weekStart ?? 1;
  const first = DateTime.utc(year, month, 1);
  const lead = (first.weekday - weekStart + 7) % 7;
  const total = Math.ceil((lead + first.daysInMonth!) / 7) * 7;
  const rows: DayCell[][] = [];
  for (let i = 0; i < total; i += 7) {
    rows.push(
      Array.from({ length: 7 }, (_, c) => {
        const d = first.plus({ days: i + c - lead });
        const ymd = ymdOf(d);
        return {
          ymd,
          day: d.day,
          inMonth: d.month === month && d.year === year,
          disabled: isDisabledYmd(ymd, opts.min, opts.max),
        };
      }),
    );
  }
  return rows;
}

/** Weekday numbers (ISO 1-7) in column order, so the header row matches the matrix. */
export function weekdayOrder(weekStart: WeekStart = 1): number[] {
  return Array.from({ length: 7 }, (_, i) => ((weekStart - 1 + i) % 7) + 1);
}

/** Whether any day of the month containing `ymd` is allowed (decides if the previous / next arrow is enabled). */
export function monthHasAllowedDay(ymd: string, min?: string, max?: string): boolean {
  const start = monthStart(ymd);
  const end = ymdOf(utc(start).endOf('month'));
  if (min && isYmd(min) && end < min) return false;
  if (max && isYmd(max) && start > max) return false;
  return true;
}

export type GridKey =
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'Home'
  | 'End'
  | 'PageUp'
  | 'PageDown';

/**
 * Where keyboard navigation lands from `ymd`. The grid reads left to right on screen, so in RTL the caller swaps
 * ArrowLeft and ArrowRight before calling. The result is clamped into min/max.
 */
export function navigateYmd(
  ymd: string,
  key: GridKey,
  opts: { shift?: boolean; weekStart?: WeekStart; min?: string; max?: string } = {},
): string {
  const weekStart = opts.weekStart ?? 1;
  const offset = (utc(ymd).weekday - weekStart + 7) % 7;
  let next: string;
  switch (key) {
    case 'ArrowLeft':
      next = addDaysYmd(ymd, -1);
      break;
    case 'ArrowRight':
      next = addDaysYmd(ymd, 1);
      break;
    case 'ArrowUp':
      next = addDaysYmd(ymd, -7);
      break;
    case 'ArrowDown':
      next = addDaysYmd(ymd, 7);
      break;
    // Start / end of the week, but never into the neighbouring month (its days are not drawn in this grid).
    case 'Home': {
      const day = addDaysYmd(ymd, -offset);
      next = day.slice(0, 7) === ymd.slice(0, 7) ? day : monthStart(ymd);
      break;
    }
    case 'End': {
      const day = addDaysYmd(ymd, 6 - offset);
      next = day.slice(0, 7) === ymd.slice(0, 7) ? day : ymdOf(utc(ymd).endOf('month'));
      break;
    }
    case 'PageUp':
      next = addMonthsYmd(ymd, opts.shift ? -12 : -1);
      break;
    case 'PageDown':
      next = addMonthsYmd(ymd, opts.shift ? 12 : 1);
      break;
  }
  return clampYmd(next, opts.min, opts.max);
}
