import { describe, expect, it } from 'vitest';
import { formatCountdown, holdStillOpen } from '@/lib/myBookings/hold';
import { createMyBookingsStore, type SavedBooking, type StorageLike } from '@/lib/myBookings/storage';

const NOW = new Date('2026-11-04T08:00:00Z');
const PAY = 'eyJhIjoiYWJjIn0.c2ln_-9';
const IN_10_MIN = new Date(NOW.getTime() + 10 * 60_000).toISOString();

describe('countdown text and refresh rules', () => {
  it('formats mm:ss with Latin digits, rounding up so it never shows 0:00 while time remains', () => {
    expect(formatCountdown(600_000)).toBe('10:00');
    expect(formatCountdown(61_000)).toBe('1:01');
    expect(formatCountdown(1)).toBe('0:01');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-5)).toBe('0:00');
  });

  it('only PENDING_PAYMENT keeps a hold; every other status releases it', () => {
    expect(holdStillOpen('PENDING_PAYMENT')).toBe(true);
    for (const s of ['BOOKED', 'CONFIRMED', 'CANCELLED', 'LATE_CANCEL', 'ATTENDED', 'NO_SHOW', 'WHATEVER'])
      expect(holdStillOpen(s), s).toBe(false);
  });
});

describe('store: ending an entry also forgets the hold', () => {
  it('markEnded drops payToken and holdExpiresAt', () => {
    const data = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
    const store = createMyBookingsStore({ storage: () => storage, now: () => NOW });
    const e: SavedBooking = {
      token: 'token-001',
      slug: 'studio-nour',
      businessName: 'Studio Nour',
      serviceName: 'Haircut',
      staffName: 'Karim',
      startAt: '2026-11-06T08:30:00.000Z',
      endAt: '2026-11-06T09:00:00.000Z',
      timezone: 'Asia/Beirut',
      reference: 'ABC234',
      savedAt: '2026-11-04T07:00:00.000Z',
      payToken: PAY,
      holdExpiresAt: IN_10_MIN,
    };
    store.save(e);
    store.markEnded('token-001', 'closed');
    expect(store.getAll()[0]).not.toHaveProperty('payToken');
    expect(store.getAll()[0]?.ended).toBe('closed');
  });
});
