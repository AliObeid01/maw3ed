import { remindersOf, type PlannedReminders } from '@/server/domain/bookingPlan';
import { reminderJobRepo } from '@/server/repositories/reminderJob.repo';

/**
 * The `reminders` of a booking, read from the stored rows (the rows ARE the plan, written by `plannedJobs`).
 * No email address on the client: nothing is promised (the runner skips every EMAIL job). A cancelled
 * appointment promises nothing. A reminder that was already sent stays true on a later replay: it did go out.
 */
export async function storedReminders(
  businessId: string,
  appointmentId: string,
): Promise<PlannedReminders> {
  const facts = await reminderJobRepo.reminderFacts(businessId, appointmentId);
  if (!facts) return { h24: false, h2: false, email: false };
  return remindersOf(facts.cancelled ? [] : facts.jobs, facts.hasEmail);
}
