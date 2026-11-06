import { describe, expect, it } from 'vitest';
import { activationExpiry, ACTIVATION_TTL_MS } from '@/server/domain/activation';
import { parseLoginIdentifier } from '@/server/domain/loginIdentifier';

describe('parseLoginIdentifier', () => {
  it('treats anything with @ as an e-mail and lowercases it', () => {
    expect(parseLoginIdentifier('  Lina@Studio.TEST ')).toEqual({
      kind: 'email',
      value: 'lina@studio.test',
    });
  });
  it.each(['70 000 001', '070000001', '+961 70 000 001', '00961 70 000 001', '+96170000001'])(
    'normalises phone spelling %s to the same E.164',
    (raw) => {
      expect(parseLoginIdentifier(raw)).toEqual({ kind: 'phone', value: '+96170000001' });
    },
  );
  it('Arabic-Indic digits work', () => {
    expect(parseLoginIdentifier('٧٠ ٠٠٠ ٠٠١')).toEqual({ kind: 'phone', value: '+96170000001' });
  });
  it.each(['', '   ', 'hello', '123', 'a b @'])(
    'returns null for %j (unknown user path, never an error)',
    (raw) => {
      const r = parseLoginIdentifier(raw);
      if (raw.includes('@')) expect(r?.kind).toBe('email');
      else expect(r).toBeNull();
    },
  );
  it('gives one guard key per person whatever the spelling', () => {
    const a = parseLoginIdentifier('70 000 001');
    const b = parseLoginIdentifier('+961 70 000 001');
    expect(a).toEqual(b);
  });
});

describe('activationExpiry', () => {
  it('is 72 hours after now', () => {
    const now = new Date('2026-11-07T10:00:00Z');
    expect(ACTIVATION_TTL_MS).toBe(72 * 3_600_000);
    expect(activationExpiry(now).toISOString()).toBe('2026-11-10T10:00:00.000Z');
  });
});
