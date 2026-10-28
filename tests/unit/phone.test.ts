import { describe, expect, it } from 'vitest';
import { formatInternational, normalizePhone } from '@/server/domain/phone';

describe('normalizePhone', () => {
  it.each([
    ['71 234 567', '+96171234567'],
    ['03 512 774', '+9613512774'],
    ['+961 3 512 774', '+9613512774'],
    ['0096171234567', '+96171234567'],
    ['+961-71-234-567', '+96171234567'],
    ['(71) 234567', '+96171234567'],
    ['  81 234 567 ', '+96181234567'],
    ['01 234 567', '+9611234567'], // Beirut landline
  ])('normalises Lebanese %j -> %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('is idempotent on E.164', () => {
    expect(normalizePhone('+96171234567')).toBe('+96171234567');
  });

  it('accepts other countries with a plus sign', () => {
    expect(normalizePhone('+44 7911 123456')).toBe('+447911123456');
    expect(normalizePhone('+1 415 555 2671')).toBe('+14155552671');
  });

  it('respects a different default region', () => {
    expect(normalizePhone('07911 123456', 'GB')).toBe('+447911123456');
  });

  it.each(['', '   ', 'abc', '123', '71', '+961', '71 234', '0000000000000000000'])('rejects %j', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe('formatInternational', () => {
  it('formats E.164 for display', () => {
    expect(formatInternational('+96171234567')).toBe('+961 71 234 567');
    expect(formatInternational('+9613512774')).toBe('+961 3 512 774');
  });
  it('returns unparseable input unchanged', () => {
    expect(formatInternational('garbage')).toBe('garbage');
  });
});
