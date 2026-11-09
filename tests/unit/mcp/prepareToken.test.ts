import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { expiryFor, signToken, verifyToken } from '@/server/domain/tokens';
import {
  PREPARE_TTL_SEC,
  signPrepareToken,
  verifyPrepareToken,
  type PreparePayload,
} from '@/server/domain/prepareToken';

const SECRET = 'test-secret-test-secret-test-secret';
const NOW = new Date('2026-11-10T09:00:00Z');
const payload: PreparePayload = {
  b: 'biz_1',
  s: 'svc_1',
  p: null,
  t: '2026-11-11T08:00:00.000Z',
  exp: Math.floor(NOW.getTime() / 1000) + PREPARE_TTL_SEC,
};

describe('prepare token', () => {
  it('lives 10 minutes', () => expect(PREPARE_TTL_SEC).toBe(600));

  it('round-trips with the business, service, staff, start and expiry', () => {
    const t = signPrepareToken(payload, SECRET);
    expect(verifyPrepareToken(t, SECRET, NOW)).toEqual({ ok: true, payload });
  });

  it('is expired from exp on', () => {
    const t = signPrepareToken(payload, SECRET);
    expect(verifyPrepareToken(t, SECRET, new Date((payload.exp - 1) * 1000)).ok).toBe(true);
    expect(verifyPrepareToken(t, SECRET, new Date(payload.exp * 1000))).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects a tampered body, a tampered signature, another secret and garbage', () => {
    const t = signPrepareToken(payload, SECRET);
    const [body, sig] = t.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify({ ...payload, s: 'svc_2' })).toString('base64url');
    expect(verifyPrepareToken(`${forged}.${sig}`, SECRET, NOW).ok).toBe(false);
    expect(verifyPrepareToken(`${body}.${sig.slice(0, -2)}AA`, SECRET, NOW).ok).toBe(false);
    expect(verifyPrepareToken(t, 'another-secret-another-secret-123456', NOW).ok).toBe(false);
    for (const bad of ['', 'x', 'a.b.c', 'a.b', '.....', 'é.é', 'x'.repeat(2000)])
      expect(verifyPrepareToken(bad, SECRET, NOW).ok).toBe(false);
  });

  it('a link token (any act) can never be replayed as a prepare token', () => {
    for (const act of ['view', 'confirm', 'cancel', 'pay'] as const) {
      const link = signToken({ a: 'appt_1', act, exp: expiryFor(new Date('2026-12-01Z')) }, SECRET);
      expect(verifyPrepareToken(link, SECRET, NOW).ok).toBe(false);
    }
  });

  it('a prepare token can never be used as a link token', () => {
    const t = signPrepareToken(payload, SECRET);
    for (const act of ['view', 'confirm', 'cancel', 'claim', 'pay', 'leave'] as const)
      expect(verifyToken(t, SECRET, NOW, act).ok).toBe(false);
  });

  it('a body signed with the raw link secret (not the derived key) is rejected', () => {
    const body = Buffer.from(JSON.stringify({ act: 'prepare', ...payload })).toString('base64url');
    const sig = createHmac('sha256', SECRET).update(body).digest().toString('base64url');
    expect(verifyPrepareToken(`${body}.${sig}`, SECRET, NOW).ok).toBe(false);
  });

  it('refuses a short secret', () => {
    expect(() => signPrepareToken(payload, 'short')).toThrow();
  });
});
