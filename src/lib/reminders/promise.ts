/** The reminders the server says will be sent (`reminders` on the booking, claim and pay responses). */
export type ReminderFlags = { h24: boolean; h2: boolean };

export type ReminderPromiseKind = 'both' | 'h24' | 'h2' | 'none';

/**
 * Which copy variant (`reminderPromise.promise`, an ICU select on this value) a confirmation shows. The
 * flags come from the server, derived from the very function that creates the reminder jobs; the client never
 * works the 24 h / 2 h windows out itself, so the page cannot promise an email that will not exist.
 */
export function reminderPromiseKind(r: ReminderFlags): ReminderPromiseKind {
  if (r.h24 && r.h2) return 'both';
  if (r.h24) return 'h24';
  if (r.h2) return 'h2';
  return 'none';
}
