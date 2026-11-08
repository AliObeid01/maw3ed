import { describe, expect, it } from 'vitest';
import {
  expiryFor,
  OUTCOME_GRACE_SEC,
  signToken,
  verifyOutcomeToken,
  verifyToken,
  type TokenAction,
} from '@/server/domain/tokens';

const SECRET = 'test-secret-test-secret-test-secret';
const start = new Date('2026-06-10T12:00:00Z');
const exp = expiryFor(start);
const DAY_MS = 86_400_000;
const sign = (act: TokenAction, a = 'appt_1') => signToken({ a, act, exp }, SECRET);
const plus = (ms: number) => new Date(start.getTime() + ms);

describe('verifyOutcomeToken (view tokens only, with a 90 day grace after the start)', () => {
  it('the grace is 90 days', () => {
    expect(OUTCOME_GRACE_SEC).toBe(90 * 24 * 3600);
  });

  it('accepts a view token before the start, at the start, and until 90 days after it', () => {
    const t = sign('view');
    for (const when of [
      plus(-3600_000),
      plus(0),
      plus(1000),
      plus(30 * DAY_MS),
      plus(90 * DAY_MS - 1000),
    ])
      expect(verifyOutcomeToken(t, SECRET, when)).toEqual({
        ok: true,
        payload: { a: 'appt_1', act: 'view', exp },
      });
  });

  it('refuses from exactly 90 days after the start (expired)', () => {
    expect(verifyOutcomeToken(sign('view'), SECRET, plus(90 * DAY_MS))).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(verifyOutcomeToken(sign('view'), SECRET, plus(400 * DAY_MS))).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it.each(['confirm', 'cancel'] as const)('refuses a %s token even inside the grace', (act) => {
    expect(verifyOutcomeToken(sign(act), SECRET, plus(DAY_MS))).toEqual({
      ok: false,
      reason: 'wrong_action',
    });
  });

  it('refuses offer tokens, bad signatures, other secrets, malformed text and an Invalid Date', () => {
    const offer = signToken({ o: 'offer_1', act: 'claim', exp }, SECRET);
    expect(verifyOutcomeToken(offer, SECRET, plus(0)).ok).toBe(false);
    const t = sign('view');
    const tampered = `${t.slice(0, -2)}${t.endsWith('AA') ? 'BB' : 'AA'}`;
    expect(verifyOutcomeToken(tampered, SECRET, plus(0))).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(verifyOutcomeToken(t, 'another-secret-another-secret-another', plus(0)).ok).toBe(false);
    expect(verifyOutcomeToken('garbage', SECRET, plus(0))).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(verifyOutcomeToken('a.b.c', SECRET, plus(0)).ok).toBe(false);
    expect(verifyOutcomeToken(t, SECRET, new Date(NaN))).toEqual({ ok: false, reason: 'expired' });
  });

  it('does not widen verifyToken: the same view token is still expired for normal use after the start', () => {
    const t = sign('view');
    expect(verifyToken(t, SECRET, plus(0), 'view')).toEqual({ ok: false, reason: 'expired' });
    expect(verifyToken(t, SECRET, plus(DAY_MS), 'view')).toEqual({ ok: false, reason: 'expired' });
    expect(verifyToken(t, SECRET, plus(-1000), 'view').ok).toBe(true);
  });
});
