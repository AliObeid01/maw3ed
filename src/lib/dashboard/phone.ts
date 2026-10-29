import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** "+961 3 555 218" for display; the raw text when it does not parse. Always wrap in `<bdi dir="ltr">`. */
export function formatPhone(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}

/** `https://wa.me/<digits>` chat link for a staff-initiated message (no prefilled text). */
export function whatsappChatUrl(e164: string): string | null {
  const digits = e164.replace(/\D/g, '');
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}

/** Two-letter initials for an avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = Array.from(parts[0]!)[0] ?? '';
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1]!)[0] ?? '') : '';
  return (first + last).toUpperCase();
}
