/**
 * Whether a reminder (H24 / H2) is written in the "already confirmed" variant: the client confirmed at or before
 * the moment the job fell due. Both timestamps are written once (confirmedAt is set by the first confirmation and
 * never moved; dueAt is fixed when the booking is made), so a retried send decides the same way and renders the
 * same bytes. A confirmation that arrives after dueAt leaves the normal variant, whatever the retry timing.
 */
export function confirmedBeforeReminder(confirmedAt: Date | null | undefined, dueAt: Date): boolean {
  return confirmedAt != null && confirmedAt.getTime() <= dueAt.getTime();
}
