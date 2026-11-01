/** The reminders the server says are planned (`reminders` on the booking, claim and pay responses). */
export type ReminderFlags = { h24: boolean; h2: boolean; email: boolean };

export type ReminderPromiseKind = 'both' | 'h24' | 'h2' | 'none' | 'noEmail';

/**
 * Which copy variant (`reminderPromise.promise`, an ICU select on this value) a confirmation shows. The
 * flags come from the server, derived from the stored reminder rows and the client's email; the client never
 * works the 24 h / 2 h windows out itself and never guesses about the email, so the page cannot promise an
 * email that will not exist.
 */
export function reminderPromiseKind(r: ReminderFlags): ReminderPromiseKind {
  if (!r.email) return 'noEmail';
  if (r.h24 && r.h2) return 'both';
  if (r.h24) return 'h24';
  if (r.h2) return 'h2';
  return 'none';
}
