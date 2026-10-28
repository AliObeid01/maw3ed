import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/** Arabic-Indic (U+0660-0669) and Eastern Arabic-Indic (U+06F0-06F9) digits -> 0-9. */
function toAsciiDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (ch) => String(ch.charCodeAt(0) % 16));
}

/** Normalises to E.164 (e.g. +96171234567) or null if not a valid number. Default region LB. */
export function normalizePhone(input: string, defaultRegion: CountryCode = 'LB'): string | null {
  const trimmed = toAsciiDigits(input.trim());
  if (!trimmed) return null;
  // Digits, spaces and common separators only: free text around a number must not be silently dropped.
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return null;
  // Accept "00" international prefix as "+".
  const cleaned = trimmed.startsWith('00') ? `+${trimmed.slice(2)}` : trimmed;
  const parsed = parsePhoneNumberFromString(cleaned, defaultRegion);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

/** '+96171234567' -> '+961 71 234 567'. Returns the input unchanged if it cannot be parsed. */
export function formatInternational(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatInternational() : e164;
}
