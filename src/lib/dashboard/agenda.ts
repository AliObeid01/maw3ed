import { DateTime } from 'luxon';
import type { TodayAppointment } from '@/lib/api/dashboard';

/** The look of an appointment: one key per tint/chip. Waitlist-sourced bookings that are still open get their own tint. */
export type ApptTone =
  | 'booked'
  | 'confirmed'
  | 'attended'
  | 'noShow'
  | 'lateCancel'
  | 'cancelled'
  | 'waitlist';

export function apptTone(appt: Pick<TodayAppointment, 'status' | 'source'>): ApptTone {
  switch (appt.status) {
    case 'ATTENDED':
      return 'attended';
    case 'NO_SHOW':
      return 'noShow';
    case 'LATE_CANCEL':
      return 'lateCancel';
    case 'CANCELLED':
      return 'cancelled';
    case 'CONFIRMED':
      return appt.source === 'WAITLIST' ? 'waitlist' : 'confirmed';
    default:
      return appt.source === 'WAITLIST' ? 'waitlist' : 'booked';
  }
}

/** Active = still occupying the calendar (cancelled and late-cancelled bookings are hidden from the day). */
export const isActive = (appt: Pick<TodayAppointment, 'status'>) =>
  appt.status !== 'CANCELLED' && appt.status !== 'LATE_CANCEL';

export type AgendaGroup = {
  /** Stable key: local hour plus UTC offset, so a repeated hour on a DST fall-back day stays two groups. */
  key: string;
  /** Local hour of day, 0-23. */
  hour: number;
  items: TodayAppointment[];
};

/**
 * Appointments grouped by local hour in the business timezone, in time order. `staffId` filters to one person
 * (`undefined` = everyone). Cancelled bookings are left out.
 */
export function groupAgenda(
  appointments: TodayAppointment[],
  timezone: string,
  staffId?: string,
): AgendaGroup[] {
  const sorted = appointments
    .filter(isActive)
    .filter((a) => !staffId || a.staff.id === staffId)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.id.localeCompare(b.id));
  const groups: AgendaGroup[] = [];
  for (const appt of sorted) {
    const local = DateTime.fromISO(appt.startAt, { zone: 'utc' }).setZone(timezone);
    const key = `${local.hour}@${local.offset}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(appt);
    else groups.push({ key, hour: local.hour, items: [appt] });
  }
  return groups;
}

/** Local `yyyy-MM-dd` of "now" in the business timezone. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  return DateTime.fromJSDate(now, { zone: timezone }).toISODate()!;
}

/** Calendar-day arithmetic on a local date (DST-safe: never adds 24 h). */
export function shiftDay(day: string, delta: number): string {
  return DateTime.fromISO(day, { zone: 'utc' }).plus({ days: delta }).toISODate()!;
}

/** Is this instant today, tomorrow or later, as a calendar day in the business timezone? */
export function dayRelation(
  iso: string,
  timezone: string,
  now: Date = new Date(),
): 'today' | 'tomorrow' | 'other' {
  const day = DateTime.fromISO(iso, { zone: 'utc' }).setZone(timezone).toISODate();
  const today = todayIn(timezone, now);
  if (day === today) return 'today';
  if (day === shiftDay(today, 1)) return 'tomorrow';
  return 'other';
}

export type Greeting = 'morning' | 'afternoon' | 'evening';

/** Greeting for the business-local hour: morning before 12:00, afternoon until 18:00. */
export function greetingFor(timezone: string, now: Date = new Date()): Greeting {
  const hour = DateTime.fromJSDate(now, { zone: timezone }).hour;
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

/** Count shown in a badge: nothing at 0, "99+" above 99. */
export function capCount(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}
