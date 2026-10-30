import { describe, expect, it } from 'vitest';
import { cancelOutcomeFor } from '@/server/domain/linkPolicy';
import {
  DEPOSIT_HOLD_MS,
  depositRequired,
  holdExpiresAtFor,
  holdIsLive,
} from '@/server/domain/deposit';

const on = { enabled: true, threshold: 1 };

describe('depositRequired', () => {
  it('is false when deposits are off, whatever the history', () => {
    expect(depositRequired({ enabled: false, threshold: 1, noShows: 9, source: 'PUBLIC' })).toBe(
      false,
    );
  });
  it('is false for a client with zero history', () => {
    expect(depositRequired({ ...on, noShows: 0, source: 'PUBLIC' })).toBe(false);
  });
  it('threshold edges: one below is free, equal and above need a deposit', () => {
    const t = { enabled: true, threshold: 3, source: 'PUBLIC' as const };
    expect(depositRequired({ ...t, noShows: 2 })).toBe(false);
    expect(depositRequired({ ...t, noShows: 3 })).toBe(true);
    expect(depositRequired({ ...t, noShows: 4 })).toBe(true);
  });
  it('front-desk bookings bypass the deposit', () => {
    expect(depositRequired({ ...on, noShows: 5, source: 'FRONT_DESK' })).toBe(false);
  });
  it('public and waitlist bookings need it', () => {
    expect(depositRequired({ ...on, noShows: 1, source: 'PUBLIC' })).toBe(true);
    expect(depositRequired({ ...on, noShows: 1, source: 'WAITLIST' })).toBe(true);
  });
  it('a threshold below 1 never makes a brand-new client pay', () => {
    expect(depositRequired({ enabled: true, threshold: 0, noShows: 0, source: 'PUBLIC' })).toBe(
      false,
    );
  });
});

describe('hold', () => {
  const now = new Date('2026-11-02T08:00:00Z');
  it('lasts 15 minutes', () => {
    expect(DEPOSIT_HOLD_MS).toBe(15 * 60_000);
    expect(holdExpiresAtFor(now).toISOString()).toBe('2026-11-02T08:15:00.000Z');
  });
  it('is live strictly before holdExpiresAt', () => {
    const exp = holdExpiresAtFor(now);
    expect(holdIsLive(exp, new Date(exp.getTime() - 1))).toBe(true);
    expect(holdIsLive(exp, exp)).toBe(false);
    expect(holdIsLive(null, now)).toBe(false);
  });
});

describe('cancelling an unpaid hold', () => {
  it('is never a late cancel, even inside the cutoff', () => {
    const start = new Date('2026-11-04T07:00:00Z');
    const now = new Date('2026-11-04T06:30:00Z'); // 30 min before, cutoff 24 h
    expect(cancelOutcomeFor('CONFIRMED', now, start, 1440)).toBe('late_cancel');
    expect(cancelOutcomeFor('PENDING_PAYMENT', now, start, 1440)).toBe('cancel');
  });
});
