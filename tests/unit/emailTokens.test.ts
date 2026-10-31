import { describe, expect, it } from 'vitest';
import {
  EMAIL_TOKEN_TTL_MS,
  emailTokenExpiry,
  emailTokenUsable,
} from '@/server/domain/emailTokens';

const NOW = new Date('2026-11-05T10:00:00.000Z');
const HOUR = 3_600_000;

describe('email token lifetimes', () => {
  it('VERIFY lasts 24 hours and RESET lasts 1 hour', () => {
    expect(EMAIL_TOKEN_TTL_MS.VERIFY).toBe(24 * HOUR);
    expect(EMAIL_TOKEN_TTL_MS.RESET).toBe(HOUR);
  });

  it('expiry is computed from the injected now, not the clock', () => {
    expect(emailTokenExpiry('VERIFY', NOW).toISOString()).toBe('2026-11-06T10:00:00.000Z');
    expect(emailTokenExpiry('RESET', NOW).toISOString()).toBe('2026-11-05T11:00:00.000Z');
  });
});

describe('emailTokenUsable', () => {
  const token = (over: { expiresAt?: Date; usedAt?: Date | null }) => ({
    expiresAt: new Date(NOW.getTime() + HOUR),
    usedAt: null,
    ...over,
  });

  it('is usable before expiry and while unused', () => {
    expect(emailTokenUsable(token({}), NOW)).toBe(true);
  });
  it('is not usable at or after the expiry instant', () => {
    expect(emailTokenUsable(token({ expiresAt: NOW }), NOW)).toBe(false);
    expect(emailTokenUsable(token({ expiresAt: new Date(NOW.getTime() - 1) }), NOW)).toBe(false);
  });
  it('is not usable once used', () => {
    expect(emailTokenUsable(token({ usedAt: NOW }), NOW)).toBe(false);
  });
});
