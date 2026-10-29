import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** A real, dialable number. Anonymised clients carry a `deleted:<id>` tombstone instead, which must never be shown or dialled. */
export const isE164 = (value: string): boolean => /^\+[1-9]\d{7,14}$/.test(value);

/** An anonymised client (their phone is a tombstone, not a number). */
export const isDeletedClient = (phone: string): boolean => !isE164(phone);

export const PHONE_DASH = '—';

/** "+961 3 555 218" for display; an em dash when it is not a real number (never a tombstone). Wrap in `<bdi dir="ltr">`. */
export function formatPhone(e164: string): string {
  if (!isE164(e164)) return PHONE_DASH;
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}

/** `tel:` link for a real number, otherwise null. */
export const telUrl = (e164: string): string | null => (isE164(e164) ? `tel:${e164}` : null);

/** `https://wa.me/<digits>` chat link for a staff-initiated message (no prefilled text); null unless a real number. */
export function whatsappChatUrl(e164: string): string | null {
  return isE164(e164) ? `https://wa.me/${e164.slice(1)}` : null;
}

/** Two-letter initials for an avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = Array.from(parts[0]!)[0] ?? '';
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1]!)[0] ?? '') : '';
  return (first + last).toUpperCase();
}
