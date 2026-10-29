import { describe, expect, it } from 'vitest';
import type { BookingBody } from '@/lib/api/booking';
import { createAttemptKeys } from '@/lib/booking/attempt';
import { assemblePhone, phoneLooksComplete } from '@/lib/booking/phone';

const body = (
  patch: Partial<BookingBody> = {},
  client: Partial<BookingBody['client']> = {},
): BookingBody => ({
  serviceId: 's1',
  staffId: 'anyone',
  startAt: '2026-11-03T08:30:00Z',
  client: { name: 'Maya', phone: '+96171234567', ...client },
  ...patch,
});

function counter() {
  let n = 0;
  return () => `key-${++n}-abcdefgh`;
}

describe('Idempotency-Key lifecycle', () => {
  it('reuses the key for retries of the same booking', () => {
    const keys = createAttemptKeys(counter());
    const first = keys.keyFor(body());
    expect(keys.keyFor(body())).toBe(first);
    expect(keys.keyFor(body())).toBe(first);
  });

  it('starts a new attempt when the slot changes', () => {
    const keys = createAttemptKeys(counter());
    const first = keys.keyFor(body());
    expect(keys.keyFor(body({ startAt: '2026-11-03T09:00:00Z' }))).not.toBe(first);
  });

  it.each([
    ['service', body({ serviceId: 's2' })],
    ['staff', body({ staffId: 'p1' })],
    ['phone', body({}, { phone: '+96170000000' })],
  ])('starts a new attempt when the %s changes', (_label, changed) => {
    const keys = createAttemptKeys(counter());
    const first = keys.keyFor(body());
    expect(keys.keyFor(changed)).not.toBe(first);
  });

  it('keeps the key when only the name or email is corrected (the server compares service, staff, start, phone)', () => {
    const keys = createAttemptKeys(counter());
    const first = keys.keyFor(body());
    expect(keys.keyFor(body({}, { name: 'Maya H.' }))).toBe(first);
    expect(keys.keyFor(body({}, { email: 'm@example.com' }))).toBe(first);
  });

  it('gives a fresh key after reset (a spent key must not be reused)', () => {
    const keys = createAttemptKeys(counter());
    const first = keys.keyFor(body());
    keys.reset();
    expect(keys.keyFor(body())).not.toBe(first);
  });

  it('generates keys the server accepts (8-100 safe characters) by default', () => {
    const key = createAttemptKeys().keyFor(body());
    expect(key).toMatch(/^[A-Za-z0-9_.:-]{8,100}$/);
  });
});

describe('assemblePhone', () => {
  it('joins the country code and the digits, dropping separators and the trunk zero', () => {
    expect(assemblePhone('+961', '71 234 567')).toBe('+96171234567');
    expect(assemblePhone('+961', '03-123 456')).toBe('+9613123456');
    expect(assemblePhone('+961', '(71) 234.567')).toBe('+96171234567');
  });

  it('keeps a number typed with its own international prefix', () => {
    expect(assemblePhone('+961', '+44 7700 900123')).toBe('+447700900123');
    expect(assemblePhone('+961', '0044 7700 900123')).toBe('+447700900123');
  });

  it('accepts Arabic-Indic and Persian digits', () => {
    expect(assemblePhone('+961', '٧١ ٢٣٤ ٥٦٧')).toBe('+96171234567');
    expect(assemblePhone('+961', '۷۱۲۳۴۵۶۷')).toBe('+96171234567');
  });

  it('is empty when there are no digits', () => {
    expect(assemblePhone('+961', ' - ')).toBe('');
  });

  it('flags numbers that are obviously incomplete', () => {
    expect(phoneLooksComplete('+961', '71 234 567')).toBe(true);
    expect(phoneLooksComplete('+961', '71')).toBe(false);
    expect(phoneLooksComplete('+961', '')).toBe(false);
  });
});
