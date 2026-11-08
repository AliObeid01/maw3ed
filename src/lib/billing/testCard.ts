/**
 * Pure helpers behind the TEST card form (`TestCardForm`). TEST MODE only: the card fields are checked and formatted
 * in the browser so the form behaves like a real one, and then they are DROPPED. Only the chosen scenario
 * ('success' | 'declined') ever leaves the page. Nothing here stores, logs or sends a digit.
 */

export type Scenario = 'success' | 'declined';
export type CardField = 'number' | 'expiry' | 'cvc' | 'name';
export type CardFieldError = 'required' | 'invalid' | 'expired';

/** The two documented test numbers. */
export const TEST_CARD_SUCCESS = '4242 4242 4242 4242';
export const TEST_CARD_DECLINED = '4000 0000 0000 0002';

const MAX_NUMBER_DIGITS = 19;
const MIN_NUMBER_DIGITS = 12;
const MAX_YEARS_AHEAD = 20;

/** Latin digits only: Arabic-Indic (U+0660..) and Eastern Arabic-Indic (U+06F0..) digits are converted. */
export function digitsOf(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x30 && code <= 0x39) out += ch;
    else if (code >= 0x660 && code <= 0x669) out += String(code - 0x660);
    else if (code >= 0x6f0 && code <= 0x6f9) out += String(code - 0x6f0);
  }
  return out;
}

export function isLuhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  if (digits.length < MIN_NUMBER_DIGITS || digits.length > MAX_NUMBER_DIGITS) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function formatCardNumber(value: string): string {
  const digits = digitsOf(value).slice(0, MAX_NUMBER_DIGITS);
  return digits.replace(/(.{4})(?=.)/g, '$1 ');
}

/** MM/YY as the person types. A first digit above 1 can only be a month, so it gets a leading zero and the slash. */
export function formatExpiry(value: string): string {
  let digits = digitsOf(value);
  const padded = digits.length > 0 && digits[0]! > '1';
  if (padded) digits = `0${digits}`;
  digits = digits.slice(0, 4);
  return digits.length > 2 || (padded && digits.length === 2)
    ? `${digits.slice(0, 2)}/${digits.slice(2)}`
    : digits;
}

export function formatCvc(value: string): string {
  return digitsOf(value).slice(0, 4);
}

/** A card is valid through the END of its expiry month. `now` is injected. */
export function validateExpiry(value: string, now: Date): CardFieldError | null {
  const match = /^(\d{2})\/(\d{2})$/.exec(value.trim());
  if (!match) return value.trim() === '' ? 'required' : 'invalid';
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  if (month < 1 || month > 12) return 'invalid';
  const nowYear = now.getUTCFullYear();
  const nowMonth = now.getUTCMonth() + 1;
  if (year < nowYear || (year === nowYear && month < nowMonth)) return 'expired';
  if (year > nowYear + MAX_YEARS_AHEAD) return 'invalid';
  return null;
}

/** The expiry "Fill test card" types: December, three years after the injected `now` (UTC year, like validateExpiry). */
export function testExpiry(now: Date): string {
  return `12/${String((now.getUTCFullYear() + 3) % 100).padStart(2, '0')}`;
}

/** The simulated outcome for a typed number: the decline test number declines, any other valid number succeeds. */
export function scenarioFor(number: string): Scenario | null {
  const digits = digitsOf(number);
  if (!isLuhnValid(digits)) return null;
  return digits === digitsOf(TEST_CARD_DECLINED) ? 'declined' : 'success';
}

export interface CardInput {
  number: string;
  expiry: string;
  cvc: string;
  name: string;
}
export type CardErrors = Partial<Record<CardField, CardFieldError>>;

export function validateCard(card: CardInput, now: Date): CardErrors {
  const errors: CardErrors = {};
  const number = digitsOf(card.number);
  if (number === '') errors.number = 'required';
  else if (!isLuhnValid(number)) errors.number = 'invalid';
  const expiry = validateExpiry(card.expiry, now);
  if (expiry) errors.expiry = expiry;
  const cvc = digitsOf(card.cvc);
  if (cvc === '') errors.cvc = 'required';
  else if (cvc.length < 3 || cvc.length > 4 || cvc !== card.cvc.trim()) errors.cvc = 'invalid';
  const name = card.name.trim();
  if (name === '') errors.name = 'required';
  else if (name.length < 2 || name.length > 80) errors.name = 'invalid';
  return errors;
}
