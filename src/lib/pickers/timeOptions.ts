/**
 * Pure helpers for the time picker. The value contract is `HH:mm` in 24 hours with Latin digits; a closing time may
 * also be `24:00` (end of day), stored as is.
 */

export const MINUTE_STEP = 5;
export const HM = /^(\d{2}):(\d{2})$/;

const pad = (n: number) => String(n).padStart(2, '0');
const sortDigits = (list: string[]) => [...list].sort((a, b) => a.localeCompare(b));

export const HOURS = Array.from({ length: 24 }, (_, h) => pad(h));
export const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => pad(i * MINUTE_STEP));

export function parseHm(value: string | undefined | null): { hour: string; minute: string } | null {
  const m = value ? HM.exec(value) : null;
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null;
  return { hour: m[1]!, minute: m[2]! };
}

/** The text shown in the field: the value itself when valid, otherwise empty (the placeholder shows). */
export function displayHm(value: string | undefined | null): string {
  return parseHm(value) && value ? value : '';
}

/**
 * Hours on offer. A closing time runs 01-24 (00 would be ambiguous with 24). A value outside the list (an imported
 * 00:30 end) stays selectable instead of silently changing.
 */
export function hourOptions(current: string, endOfDay?: boolean): string[] {
  const base = endOfDay ? [...HOURS.slice(1), '24'] : HOURS;
  return current && !base.includes(current) ? sortDigits([current, ...base]) : base;
}

/** Minutes on offer: the 5-minute grid, plus an off-grid current minute; only `00` when the hour is 24. */
export function minuteOptions(current: string, hour: string, endOfDay?: boolean): string[] {
  if (endOfDay && hour === '24') return ['00'];
  return current && !MINUTES.includes(current) ? sortDigits([...MINUTES, current]) : MINUTES;
}

/** The value after choosing an hour: `24` locks the minutes to 00; otherwise the minute is kept (default 00). */
export function withHour(hour: string, currentMinute: string, endOfDay?: boolean): string {
  if (endOfDay && hour === '24') return '24:00';
  return `${hour}:${currentMinute || '00'}`;
}

/** The value after choosing a minute (the hour defaults to 00 when none is chosen yet). */
export function withMinute(currentHour: string, minute: string): string {
  return `${currentHour || '00'}:${minute}`;
}
