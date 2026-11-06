import { normalizePhone } from './phone';

export type LoginIdentifier = { kind: 'email'; value: string } | { kind: 'phone'; value: string };

/**
 * What the login box holds: an e-mail (anything with "@", lowercased) or a phone number (E.164, default
 * region LB). Garbage is `null`: the caller treats it as an unknown account (dummy hash, same 401), never
 * as a different error, so the form cannot be used to learn anything.
 */
export function parseLoginIdentifier(raw: string): LoginIdentifier | null {
  const text = raw.trim();
  if (!text) return null;
  if (text.includes('@')) return { kind: 'email', value: text.toLowerCase() };
  const phone = normalizePhone(text);
  return phone ? { kind: 'phone', value: phone } : null;
}
