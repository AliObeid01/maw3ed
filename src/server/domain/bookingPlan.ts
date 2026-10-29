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
