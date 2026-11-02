/**
 * F16: the address an appointment's emails go to.
 * `appointment.contactEmail` (typed for THAT booking) wins; otherwise the client record's email, so every
 * appointment created before F16 (contactEmail NULL) keeps getting its reminders. Pure: no I/O.
 */
export function effectiveEmail(
  contactEmail: string | null | undefined,
  clientEmail: string | null | undefined,
): string | null {
  const own = contactEmail?.trim();
  if (own) return own;
  const record = clientEmail?.trim();
  return record ? record : null;
}

/** Trim + lowercase what a booker typed; blank means "none given". */
export function normaliseContactEmail(raw: string | null | undefined): string | undefined {
  const v = raw?.trim().toLowerCase();
  return v ? v : undefined;
}
