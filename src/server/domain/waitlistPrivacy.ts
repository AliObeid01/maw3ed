/**
 * What the staff waitlist list may show about a client (NFR-04). Pure.
 * The full phone and the email never leave the server for that endpoint.
 */

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

const digitsOf = (value: string) =>
  [...value]
    .map((ch) => {
      const a = ARABIC_INDIC.indexOf(ch);
      if (a >= 0) return String(a);
      const p = EASTERN_PERSIAN.indexOf(ch);
      return p >= 0 ? String(p) : ch;
    })
    .join('')
    .replace(/\D/g, '');

/** Shown instead of a number that is too short to hide anything. */
export const MASKED_PHONE_NONE = '•••• ••• •••';

/**
 * `+96171123456` -> `•••• ••• 456`: always the same shape (so the length is not revealed) and Latin digits
 * only, with the last 3 digits visible. Fewer than 7 digits (not a real phone) shows no digit at all.
 */
export function maskPhone(phone: string): string {
  const digits = digitsOf(phone);
  if (digits.length < 7) return MASKED_PHONE_NONE;
  return `•••• ••• ${digits.slice(-3)}`;
}

/** The first word of a name ('' for an empty name). */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}
