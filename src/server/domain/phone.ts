import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/** Normalises to E.164 (e.g. +96171234567) or null if not a valid number. Default region LB. */
export function normalizePhone(input: string, defaultRegion: CountryCode = 'LB'): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
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
