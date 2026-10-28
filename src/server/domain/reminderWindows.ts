export type ReminderKind = 'H24' | 'H2';

const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;

export interface PlannedReminder {
  kind: ReminderKind;
  dueAt: Date;
}

/** H24 only if booked at least 24 h ahead; H2 only if booked at least 2 h ahead. */
export function reminderPlan(startAt: Date, bookedAt: Date): PlannedReminder[] {
  const lead = startAt.getTime() - bookedAt.getTime();
  const plan: PlannedReminder[] = [];
  if (lead >= 24 * HOUR_MS) plan.push({ kind: 'H24', dueAt: new Date(startAt.getTime() - 24 * HOUR_MS) });
  if (lead >= 2 * HOUR_MS) plan.push({ kind: 'H2', dueAt: new Date(startAt.getTime() - 2 * HOUR_MS) });
  return plan;
}

/**
 * Re-check at send time. Skip when the appointment is inactive; H24 once now >= start - 2 h;
 * H2 once now > start - 15 min.
 */
export function sendDecision(
  kind: ReminderKind,
  startAt: Date,
  now: Date,
  appointmentActive: boolean,
): 'SEND' | 'SKIP' {
  if (!appointmentActive) return 'SKIP';
  const start = startAt.getTime();
  const t = now.getTime();
  if (kind === 'H24') return t >= start - 2 * HOUR_MS ? 'SKIP' : 'SEND';
  return t > start - 15 * MIN_MS ? 'SKIP' : 'SEND';
}
