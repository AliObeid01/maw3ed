/**
 * F16: the address an appointment's emails go to.
 * `appointment.contactEmail` (typed for THAT booking) wins; otherwise the client record's email, so every
 * appointment created before F16 (contactEmail NULL) keeps getting its reminders. Pure: no I/O.
 *
 * A stored value that fails a basic shape check (exactly one '@', 3..254 characters, no whitespace) is
 * treated as no address, so the runner skips it as `no_email` instead of failing at the provider.
 */
export function isPlausibleEmail(value: string): boolean {
  return (
    value.length >= 3 &&
    value.length <= 254 &&
    !/\s/.test(value) &&
    value.split('@').length === 2 &&
    !value.startsWith('@') &&
    !value.endsWith('@')
  );
}

export function effectiveEmail(
  contactEmail: string | null | undefined,
  clientEmail: string | null | undefined,
): string | null {
  const chosen = contactEmail?.trim() || clientEmail?.trim();
  if (!chosen) return null;
  return isPlausibleEmail(chosen) ? chosen : null;
}

/**
 * The name an email may greet the recipient with. The client RECORD name is only ever shown to the holder of
 * the RECORD email: if the recipient (the address typed for this booking) is anyone else, or the record has
 * no email, the mail is greeted generically (null). Otherwise anyone booking with a victim's phone and their
 * own email would learn the victim's name from the greeting.
 */
export function greetingName(
  recipient: string | null | undefined,
  recordEmail: string | null | undefined,
  recordName: string,
): string | null {
  const to = recipient?.trim().toLowerCase();
  const rec = recordEmail?.trim().toLowerCase();
  if (!to || !rec || to !== rec) return null;
  return recordName;
}

/**
 * The greeting name of one appointment's email. Preference: the name typed for THAT booking
 * (`contactName`), which the recipient's own booker chose. Otherwise (a pre-F16 row, or a waitlist claim)
 * the record name, but only if the recipient is the record email (`greetingName`); else null = generic.
 */
export function mailGreetingName(a: {
  contactName: string | null | undefined;
  recipient: string | null | undefined;
  recordEmail: string | null | undefined;
  recordName: string;
}): string | null {
  const typed = a.contactName?.trim();
  if (typed) return typed;
  return greetingName(a.recipient, a.recordEmail, a.recordName);
}

/** Trim + lowercase what a booker typed; blank means "none given". */
export function normaliseContactEmail(raw: string | null | undefined): string | undefined {
  const v = raw?.trim().toLowerCase();
  return v ? v : undefined;
}

/**
 * F69-C: a booking's contact details may be corrected only while it is still ahead of us and still a live
 * booking (BOOKED or CONFIRMED). Past, cancelled, attended, no-show and unpaid-hold appointments are final.
 * `now` is injected.
 */
export function isContactEditable(a: { status: string; startAt: Date }, now: Date): boolean {
  return (a.status === 'BOOKED' || a.status === 'CONFIRMED') && a.startAt.getTime() > now.getTime();
}
