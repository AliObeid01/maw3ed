import { describe, expect, it } from 'vitest';
import {
  CONSENT_TTL_SEC,
  deriveConsentKey,
  signConsent,
  verifyConsent,
  type ConsentPayload,
} from '@/server/domain/consentToken';

const key = deriveConsentKey('unit-test-link-secret-0123456789abcdef');
const now = new Date('2026-11-12T10:00:00Z');
const base: ConsentPayload = {
  u: 'user-1',
  b: 'biz-1',
  c: 'maw3ed-claude',
  r: 'https://claude.ai/api/mcp/auth_callback',
  ch: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  s: 'state-xyz',
  res: 'https://maw3ed.test/api/mcp/owner',
  sc: 'setup',
  n: 'nonce-1',
  exp: Math.floor(now.getTime() / 1000) + CONSENT_TTL_SEC,
};
const who = { userId: 'user-1', businessId: 'biz-1' };

describe('consent form token', () => {
  it('round-trips for the same user and business', () => {
    const r = verifyConsent(signConsent(base, key), key, now, who);
    expect(r).toEqual({ ok: true, payload: base });
  });
  it('lives 10 minutes', () => {
    expect(CONSENT_TTL_SEC).toBe(600);
    const t = signConsent(base, key);
    const late = new Date(now.getTime() + 601_000);
    expect(verifyConsent(t, key, late, who)).toEqual({ ok: false, reason: 'expired' });
  });
  it('is bound to the user and the business (another user cannot submit it)', () => {
    const t = signConsent(base, key);
    expect(verifyConsent(t, key, now, { userId: 'user-2', businessId: 'biz-1' })).toMatchObject({ ok: false });
    expect(verifyConsent(t, key, now, { userId: 'user-1', businessId: 'biz-2' })).toMatchObject({ ok: false });
  });
  it('detects a changed redirect_uri, challenge, state or client (any payload tampering)', () => {
    const [body, sig] = signConsent(base, key).split('.');
    for (const change of [
      { r: 'https://evil.example/cb' },
      { ch: 'A'.repeat(43) },
      { s: 'other' },
      { c: 'other-client' },
      { u: 'user-2' },
    ]) {
      const forged = Buffer.from(JSON.stringify({ ...base, ...change })).toString('base64url');
      expect(verifyConsent(`${forged}.${sig}`, key, now, who)).toEqual({ ok: false, reason: 'bad_signature' });
    }
    expect(body).toBeTruthy();
  });
  it('rejects a token signed with another key and garbage', () => {
    const other = deriveConsentKey('another-secret-another-secret-another-secret');
    expect(verifyConsent(signConsent(base, other), key, now, who)).toEqual({ ok: false, reason: 'bad_signature' });
    for (const junk of ['', 'abc', 'a.b', '.', 'x'.repeat(5000)])
      expect(verifyConsent(junk, key, now, who).ok).toBe(false);
  });
  it('uses a key separated from the raw secret (HKDF, domain-separated)', () => {
    expect(key.length).toBe(32);
    expect(key.toString('utf8')).not.toContain('unit-test');
  });
});
