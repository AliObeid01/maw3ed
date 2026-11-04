import { reminderPlan } from './reminderWindows';

export type PlannedJob = {
  kind: 'BOOKING' | 'H24' | 'H2' | 'LATE';
  channel: 'EMAIL' | 'WHATSAPP';
  dueAt: Date;
};

export type BookingSource = 'PUBLIC' | 'FRONT_DESK' | 'WAITLIST';

const LATE_LEAD_MS = 2 * 3_600_000;

/**
 * Reminder rows created with a booking: BOOKING/EMAIL due now, and H24/H2 for EMAIL and WHATSAPP when the
 * lead time allows (booked < 24 h ahead: no H24; < 2 h: no H2).
 *
 * F68: a PUBLIC booking made less than 2 h ahead gets neither reminder, so the receptionist would never hear of
 * it. It gets ONE WhatsApp row of kind LATE instead, due at once (never an EMAIL row: the client already has
 * the booking email). Front-desk and waitlist-claim bookings get none: the receptionist made them, or the
 * client was just notified by the offer. Without a `source` no LATE row is planned.
 */
export function plannedJobs(
  startAt: Date,
  bookedAt: Date,
  opts: { source?: BookingSource | undefined } = {},
): PlannedJob[] {
  const jobs: PlannedJob[] = [{ kind: 'BOOKING', channel: 'EMAIL', dueAt: bookedAt }];
  for (const r of reminderPlan(startAt, bookedAt)) {
    jobs.push({ kind: r.kind, channel: 'EMAIL', dueAt: r.dueAt });
    jobs.push({ kind: r.kind, channel: 'WHATSAPP', dueAt: r.dueAt });
  }
  if (opts.source === 'PUBLIC' && startAt.getTime() - bookedAt.getTime() < LATE_LEAD_MS)
    jobs.push({ kind: 'LATE', channel: 'WHATSAPP', dueAt: bookedAt });
  return jobs;
}

/**
 * What the immediate booking email carries (F68), decided by the same lead rule that plans the reminders:
 * - `links: 'cancel'` when an H24 reminder will follow (booked at least 24 h ahead): it carries Confirm and
 *   Cancel, so the booking email only needs Cancel;
 * - `links: 'both'` otherwise (no H24 will come, so this email is the client's only Confirm link before H2).
 * - `reminderPromise`: a reminder email really is planned for a client with an email (the F44 promise).
 * Pure and deterministic: a retried send is byte-for-byte the same.
 */
export interface BookingEmailPlan {
  links: 'both' | 'cancel';
  reminderPromise: boolean;
}

export function bookingEmailPlan(startAt: Date, bookedAt: Date, hasEmail = true): BookingEmailPlan {
  const r = plannedReminders(startAt, bookedAt, hasEmail);
  const h24Planned = reminderPlan(startAt, bookedAt).some((p) => p.kind === 'H24');
  return { links: h24Planned ? 'cancel' : 'both', reminderPromise: r.h24 || r.h2 };
}

/**
 * The email reminders a booking has planned (a send can still be skipped, for example by the daily email
 * budget). The ONLY thing a page may promise. `email` is whether the client has an address at all: without
 * one the runner skips every EMAIL job (`no_email`), so nothing is promised.
 */
export interface PlannedReminders {
  h24: boolean;
  h2: boolean;
  email: boolean;
}

/**
 * Reduce reminder rows (planned or stored) to what the client may be promised: the EMAIL H24 / H2 rows, and
 * only when the client has an email address. BOOKING is the confirmation, and WhatsApp rows are the
 * receptionist's, never an email to the client. The rows themselves are not changed: WhatsApp shares the plan.
 */
export function remindersOf(
  jobs: readonly { kind: string; channel?: string | undefined }[],
  hasEmail = true,
): PlannedReminders {
  const email = jobs.filter((j) => j.channel === undefined || j.channel === 'EMAIL');
  return {
    h24: hasEmail && email.some((j) => j.kind === 'H24'),
    h2: hasEmail && email.some((j) => j.kind === 'H2'),
    email: hasEmail,
  };
}

/** The reminders `plannedJobs(startAt, bookedAt)` would create: one function decides both. */
export function plannedReminders(startAt: Date, bookedAt: Date, hasEmail = true): PlannedReminders {
  return remindersOf(plannedJobs(startAt, bookedAt), hasEmail);
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
