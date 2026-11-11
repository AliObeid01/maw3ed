import { DateTime } from 'luxon';
import { toMinutes, type HoursInterval } from './hours';

/** "Open now / until" for the public directory. Clock times are HH:mm in the business zone. */
export interface OpenStatus {
  open: boolean;
  /** Closing time of the interval we are in (open only). */
  until?: string;
  /** Next opening later TODAY (closed only); absent when it is closed for the rest of the day. */
  opensAt?: string;
}

const hhmm = (minutes: number): string => {
  const m = minutes % 1440; // 24:00 is written 00:00
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * Whether a business is open right now, from the UNION of its staff's weekly working-hour intervals for the
 * local day (overlapping or touching intervals of different staff merge into one). Pure: `now` is injected and the
 * day and clock are read in the business `timezone`, so a DST change only moves the offset, never the local hours.
 *
 * Deliberately simple: time off and existing bookings are IGNORED (it answers "are the doors open by the posted
 * hours", not "is a slot free"; free times are shown separately). Derived from public working hours only, it
 * exposes no staff, client or appointment data.
 */
export function openStatus(hours: readonly HoursInterval[], timezone: string, now: Date): OpenStatus {
  const local = DateTime.fromMillis(now.getTime(), { zone: timezone });
  if (!local.isValid) return { open: false };
  const weekday = local.weekday % 7; // Luxon: Monday 1 to Sunday 7; WorkingHours: Sunday 0 to Saturday 6
  const minute = local.hour * 60 + local.minute;

  const today = hours
    .filter((h) => h.weekday === weekday)
    .map((h) => ({ start: toMinutes(h.startLocal), end: toMinutes(h.endLocal) }))
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const i of today) {
    const last = merged[merged.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else merged.push({ ...i });
  }

  const current = merged.find((i) => i.start <= minute && minute < i.end);
  if (current) return { open: true, until: hhmm(current.end) };
  const next = merged.find((i) => i.start > minute);
  return next ? { open: false, opensAt: hhmm(next.start) } : { open: false };
}
