export type Country = { dial: string; code: string };

/** Country-code choices for the phone field; +961 (Lebanon) first. The server normalises and validates the number. */
export const COUNTRIES: readonly Country[] = [
  { dial: '+961', code: 'LB' },
  { dial: '+963', code: 'SY' },
  { dial: '+962', code: 'JO' },
  { dial: '+972', code: 'IL' },
  { dial: '+20', code: 'EG' },
  { dial: '+966', code: 'SA' },
  { dial: '+971', code: 'AE' },
  { dial: '+974', code: 'QA' },
  { dial: '+965', code: 'KW' },
  { dial: '+973', code: 'BH' },
  { dial: '+968', code: 'OM' },
  { dial: '+964', code: 'IQ' },
  { dial: '+90', code: 'TR' },
  { dial: '+357', code: 'CY' },
  { dial: '+30', code: 'GR' },
  { dial: '+33', code: 'FR' },
  { dial: '+44', code: 'GB' },
  { dial: '+49', code: 'DE' },
  { dial: '+1', code: 'US' },
  { dial: '+61', code: 'AU' },
];

export const DEFAULT_DIAL = '+961';

/** Eastern Arabic and Persian digits to Latin, so a phone typed on an Arabic keyboard still works. */
function toLatinDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * E.164-style text from the country code and what the person typed. Spaces, dashes and brackets go; the national
 * trunk "0" is dropped ("03 123 456" with +961 -> "+9613123456"); a number typed with its own "+" or "00" prefix is
 * sent as written and the selected country is ignored.
 */
export function assemblePhone(dial: string, typed: string): string {
  const latin = toLatinDigits(typed).trim();
  const digits = latin.replace(/\D/g, '');
  if (!digits) return '';
  if (latin.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  return `${dial}${digits.replace(/^0+/, '')}`;
}

/** Cheap sanity check (the server does the real one): enough digits for any national number. */
export function phoneLooksComplete(dial: string, typed: string): boolean {
  const assembled = assemblePhone(dial, typed);
  const digits = assembled.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}
