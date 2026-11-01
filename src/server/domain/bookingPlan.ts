import { reminderPlan } from './reminderWindows';

export type PlannedJob = {
  kind: 'BOOKING' | 'H24' | 'H2';
  channel: 'EMAIL' | 'WHATSAPP';
  dueAt: Date;
};

/**
 * Reminder rows created with a booking: BOOKING/EMAIL due now, and H24/H2 for EMAIL and WHATSAPP when the
 * lead time allows (booked < 24 h ahead: no H24; < 2 h: no H2).
 */
export function plannedJobs(startAt: Date, bookedAt: Date): PlannedJob[] {
  const jobs: PlannedJob[] = [{ kind: 'BOOKING', channel: 'EMAIL', dueAt: bookedAt }];
  for (const r of reminderPlan(startAt, bookedAt)) {
    jobs.push({ kind: r.kind, channel: 'EMAIL', dueAt: r.dueAt });
    jobs.push({ kind: r.kind, channel: 'WHATSAPP', dueAt: r.dueAt });
  }
  return jobs;
}

/** Which email reminders a booking has (or will have). The ONLY thing a page or email may promise. */
export interface PlannedReminders {
  h24: boolean;
  h2: boolean;
}

/**
 * Reduce reminder rows (planned or stored) to what the client may be promised: the EMAIL H24 / H2 rows.
 * BOOKING is the confirmation, and WhatsApp rows are the receptionist's, never an email to the client.
 */
export function remindersOf(
  jobs: readonly { kind: string; channel?: string | undefined }[],
): PlannedReminders {
  const email = jobs.filter((j) => j.channel === undefined || j.channel === 'EMAIL');
  return {
    h24: email.some((j) => j.kind === 'H24'),
    h2: email.some((j) => j.kind === 'H2'),
  };
}

/** The reminders `plannedJobs(startAt, bookedAt)` would create: one function decides both. */
export function plannedReminders(startAt: Date, bookedAt: Date): PlannedReminders {
  return remindersOf(plannedJobs(startAt, bookedAt));
}

export interface BookingFingerprint {
  serviceId: string;
  staffId: string;
  startAt: Date;
  phone: string;
}

/**
 * Does a replayed Idempotency-Key carry the same request as the stored booking? 'anyone' matches whichever
 * staff member was picked. Anything else differing means the key is being reused for another booking.
 */
export function sameBookingRequest(
  stored: { serviceId: string; staffId: string; startAt: Date; phone: string },
  request: BookingFingerprint,
): boolean {
  return (
    stored.serviceId === request.serviceId &&
    stored.startAt.getTime() === request.startAt.getTime() &&
    stored.phone === request.phone &&
    (request.staffId === 'anyone' || request.staffId === stored.staffId)
  );
}
