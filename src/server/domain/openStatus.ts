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

  const mergedFor = (wd: number) => {
    const day = hours
      .filter((h) => h.weekday === wd)
      .map((h) => ({ start: toMinutes(h.startLocal), end: toMinutes(h.endLocal) }))
      .sort((a, b) => a.start - b.start);
    const out: { start: number; end: number }[] = [];
    for (const i of day) {
      const last = out[out.length - 1];
      if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
      else out.push({ ...i });
    }
    return out;
  };
  const merged = mergedFor(weekday);

  const current = merged.find((i) => i.start <= minute && minute < i.end);
  if (current) {
    // Open until 24:00 and the next day opens at 00:00: it is one continuous run, report where it really ends.
    let end = current.end;
    let hops = 0;
    while (end === 1440 && hops < 7) {
      const first = mergedFor((weekday + hops + 1) % 7)[0];
      if (!first || first.start !== 0) break;
      end = first.end;
      hops += 1;
      if (end !== 1440) return { open: true, until: hhmm(end) };
    }
    // 24:00 with nothing continuing is a real midnight close ("until 00:00"); never closing at all has no time.
    return end === 1440 && hops >= 7 ? { open: true } : { open: true, until: hhmm(end) };
  }
  const next = merged.find((i) => i.start > minute);
  return next ? { open: false, opensAt: hhmm(next.start) } : { open: false };
}
