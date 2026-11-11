import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * The signed one-time form token of the consent page (CSRF defence in depth, next to SameSite and the Origin check).
 * HMAC-SHA256 over every parameter of the authorization request plus the signed-in user and business, so the
 * decision POST cannot be forged, retargeted at another redirect_uri/challenge/state, or submitted by another
 * user. The key is derived from an existing server secret with HKDF and a purpose label. One-time use is enforced
 * by the `consentNonce` unique column of the issued code. Pure: `now` and the key are injected.
 */
export const CONSENT_TTL_SEC = 10 * 60;
const MAX_TOKEN_LENGTH = 3000;

export interface ConsentPayload {
  /** userId */
  u: string;
  /** businessId */
  b: string;
  /** client_id */
  c: string;
  /** redirect_uri */
  r: string;
  /** code_challenge */
  ch: string;
  /** state (may be empty) */
  s: string;
  /** resource (RFC 8707) or null */
  res: string | null;
  /** scope */
  sc: string;
  /** random nonce, single use */
  n: string;
  /** epoch seconds */
  exp: number;
}

export type ConsentVerifyResult =
  | { ok: true; payload: ConsentPayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_subject' };

export function deriveConsentKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'maw3ed', 'maw3ed.oauth.consent.v1', 32));
}

const mac = (body: string, key: Buffer) =>
  createHmac('sha256', key).update(`consent.${body}`).digest();

export function signConsent(payload: ConsentPayload, key: Buffer): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${mac(body, key).toString('base64url')}`;
}

export function verifyConsent(
  token: string,
  key: Buffer,
  now: Date,
  expected: { userId: string; businessId: string },
): ConsentVerifyResult {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const [body, sig] = parts as [string, string];
  const given = Buffer.from(sig, 'base64url');
  const want = mac(body, key);
  if (given.length !== want.length || !timingSafeEqual(given, want))
    return { ok: false, reason: 'bad_signature' };
  let payload: ConsentPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ConsentPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof payload?.exp !== 'number' || typeof payload.u !== 'string' || typeof payload.b !== 'string')
    return { ok: false, reason: 'malformed' };
  if (payload.exp * 1000 <= now.getTime()) return { ok: false, reason: 'expired' };
  if (payload.u !== expected.userId || payload.b !== expected.businessId)
    return { ok: false, reason: 'wrong_subject' };
  return { ok: true, payload };
}
