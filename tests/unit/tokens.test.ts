import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  expiryFor,
  offerExpiryFor,
  signToken,
  verifyToken,
  type TokenPayload,
} from '@/server/domain/tokens';

const SECRET = 'test-secret-test-secret-test-secret';
const start = new Date('2026-06-10T12:00:00Z');
const exp = expiryFor(start);
const before = new Date('2026-06-10T11:00:00Z');
const payload: TokenPayload = { a: 'appt_1', act: 'confirm', exp };

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

describe('tokens', () => {
  it('round-trips an appointment token', () => {
    const t = signToken(payload, SECRET);
    expect(t).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(verifyToken(t, SECRET, before, 'confirm')).toEqual({ ok: true, payload });
  });

  it('round-trips an offer token', () => {
    const p: TokenPayload = {
      o: 'offer_1',
      act: 'claim',
      exp: offerExpiryFor(new Date('2026-06-10T11:30:00Z')),
    };
    expect(verifyToken(signToken(p, SECRET), SECRET, before, 'claim')).toEqual({
      ok: true,
      payload: p,
    });
  });

  it('expiryFor / offerExpiryFor give epoch seconds', () => {
    expect(exp).toBe(Date.parse('2026-06-10T12:00:00Z') / 1000);
    expect(offerExpiryFor(new Date(1_700_000_000_500))).toBe(1_700_000_000);
  });

  it('expires at the start instant', () => {
    const t = signToken(payload, SECRET);
    expect(verifyToken(t, SECRET, new Date(start.getTime() - 1000), 'confirm').ok).toBe(true);
    expect(verifyToken(t, SECRET, start, 'confirm')).toEqual({ ok: false, reason: 'expired' });
    expect(verifyToken(t, SECRET, new Date(start.getTime() + 1), 'confirm')).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects wrong action', () => {
    expect(verifyToken(signToken(payload, SECRET), SECRET, before, 'cancel')).toEqual({
      ok: false,
      reason: 'wrong_action',
    });
  });

  it('rejects wrong secret', () => {
    expect(
      verifyToken(
        signToken(payload, SECRET),
        'other-secret-other-secret-other-secret',
        before,
        'confirm',
      ),
    ).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects a tampered payload', () => {
    const [, sig] = signToken(payload, SECRET).split('.');
    const forged = b64(JSON.stringify({ a: 'appt_2', act: 'confirm', exp }));
    expect(verifyToken(`${forged}.${sig}`, SECRET, before, 'confirm')).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects a tampered, truncated or empty signature without throwing', () => {
    const [body, sig] = signToken(payload, SECRET).split('.') as [string, string];
    const flipped = (sig.startsWith('A') ? 'B' : 'A') + sig.slice(1);
    expect(verifyToken(`${body}.${flipped}`, SECRET, before, 'confirm')).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(verifyToken(`${body}.${sig.slice(0, 10)}`, SECRET, before, 'confirm')).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(verifyToken(`${body}.${sig}${sig}`, SECRET, before, 'confirm')).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it.each(['', 'abc', 'a.b.c', '.', 'abc.', '.abc', 'not base64!.sig'])(
    'rejects malformed %j',
    (bad) => {
      expect(verifyToken(bad, SECRET, before, 'confirm')).toEqual({
        ok: false,
        reason: 'malformed',
      });
    },
  );

  it('correctly signed but structurally invalid payloads are malformed', () => {
    const sign = (raw: string) => {
      const body = b64(raw);
      return `${body}.${createHmac('sha256', SECRET).update(body).digest('base64url')}`;
    };
    for (const raw of [
      'not json',
      '[]',
      'null',
      JSON.stringify({ act: 'confirm', exp }),
      JSON.stringify({ a: 'x', o: 'y', act: 'confirm', exp }),
      JSON.stringify({ a: 'x', act: 'delete', exp }),
      JSON.stringify({ a: 'x', act: 'confirm', exp: 'soon' }),
    ]) {
      expect(verifyToken(sign(raw), SECRET, before, 'confirm')).toEqual({
        ok: false,
        reason: 'malformed',
      });
    }
  });
});

describe('tokens hardening', () => {
  it('treats an invalid clock as expired (fails closed)', () => {
    const t = signToken(payload, SECRET);
    expect(verifyToken(t, SECRET, new Date(Number.NaN), 'confirm')).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('leave tokens name an offer and are not interchangeable with claim tokens', () => {
    const leave = signToken({ o: 'offer_1', act: 'leave', exp }, SECRET);
    expect(verifyToken(leave, SECRET, before, 'leave').ok).toBe(true);
    expect(verifyToken(leave, SECRET, before, 'claim')).toEqual({
      ok: false,
      reason: 'wrong_action',
    });
    const claim = signToken({ o: 'offer_1', act: 'claim', exp }, SECRET);
    expect(verifyToken(claim, SECRET, before, 'leave')).toEqual({
      ok: false,
      reason: 'wrong_action',
    });
    expect(() => signToken({ a: 'appt_1', act: 'leave', exp }, SECRET)).toThrow();
  });

  it('ties the subject to the action: only claim and leave use an offer id', () => {
    expect(() => signToken({ o: 'offer_1', act: 'cancel', exp }, SECRET)).toThrow();
    expect(() => signToken({ a: 'appt_1', act: 'claim', exp }, SECRET)).toThrow();
    // A correctly signed token with a mismatched shape is rejected on verify as well.
    const body = b64(JSON.stringify({ o: 'offer_1', act: 'cancel', exp }));
    const sig = createHmac('sha256', SECRET).update(body).digest().toString('base64url');
    expect(verifyToken(`${body}.${sig}`, SECRET, before, 'cancel')).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('refuses to sign or verify with a short secret', () => {
    expect(() => signToken(payload, 'short')).toThrow();
    expect(() => verifyToken('a.b', 'short', before, 'confirm')).toThrow();
  });

  it('rejects oversized tokens before doing any crypto', () => {
    const long = `${'a'.repeat(600)}.${'b'.repeat(10)}`;
    expect(verifyToken(long, SECRET, before, 'confirm')).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('rejects a signature with non-canonical base64url padding bits', () => {
    const t = signToken(payload, SECRET);
    const [body, sig] = t.split('.') as [string, string];
    // The last base64url char of a 32-byte MAC carries 2 unused bits; flip them to a different but decodable char.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const last = sig.at(-1)!;
    const altered =
      alphabet[
        (alphabet.indexOf(last) + 1) % 4 === 0
          ? alphabet.indexOf(last) + 1
          : alphabet.indexOf(last) ^ 1
      ]!;
    if (altered !== last) {
      expect(
        verifyToken(`${body}.${sig.slice(0, -1)}${altered}`, SECRET, before, 'confirm').ok,
      ).toBe(false);
    }
  });
});
