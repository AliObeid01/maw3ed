import { describe, expect, it } from 'vitest';
import {
  STORAGE_KEY,
  createMyBookingsStore,
  entryFromBooking,
  parseStored,
  type SavedBooking,
  type StorageLike,
} from '@/lib/myBookings/storage';
import { holdMsLeft, holdThresholdKey, isHeld } from '@/lib/myBookings/hold';

const NOW = new Date('2026-11-04T08:00:00Z');
const PAY = 'eyJhIjoiYWJjIn0.c2ln_-9';
const IN_10_MIN = new Date(NOW.getTime() + 10 * 60_000).toISOString();

const entry = (over: Partial<SavedBooking> = {}): SavedBooking => ({
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
  ...over,
});
const file = (...entries: unknown[]) => JSON.stringify({ v: 1, entries });

describe('parseStored: the unpaid deposit hold fields', () => {
  it('reads payToken and holdExpiresAt together', () => {
    const [e] = parseStored(file(entry({ payToken: PAY, holdExpiresAt: IN_10_MIN })), NOW);
    expect(e).toMatchObject({ payToken: PAY, holdExpiresAt: IN_10_MIN });
  });

  it('old v1 entries without the fields still read unchanged', () => {
    const [e] = parseStored(file(entry()), NOW);
    expect(e).toBeDefined();
    expect(e).not.toHaveProperty('payToken');
    expect(e).not.toHaveProperty('holdExpiresAt');
  });

  it('drops both fields when only one is present', () => {
    for (const over of [{ payToken: PAY }, { holdExpiresAt: IN_10_MIN }]) {
      const [e] = parseStored(file(entry(over)), NOW);
      expect(e).toBeDefined();
      expect(e).not.toHaveProperty('payToken');
      expect(e).not.toHaveProperty('holdExpiresAt');
    }
  });

  it('drops a hold that already expired (the entry itself stays)', () => {
    const past = new Date(NOW.getTime() - 1000).toISOString();
    const [e] = parseStored(file(entry({ payToken: PAY, holdExpiresAt: past })), NOW);
    expect(e?.token).toBe('token-001');
    expect(e).not.toHaveProperty('payToken');
  });

  it('hostile values never reach the entry: bad token shapes, bad dates, wrong types', () => {
    const hostile: Array<Record<string, unknown>> = [
      { payToken: '../../evil', holdExpiresAt: IN_10_MIN },
      { payToken: 'https://evil.com/x', holdExpiresAt: IN_10_MIN },
      { payToken: 'javascript:alert(1)', holdExpiresAt: IN_10_MIN },
      { payToken: '<script>alert(1)</script>', holdExpiresAt: IN_10_MIN },
      { payToken: 'a b c d e f g h', holdExpiresAt: IN_10_MIN },
      { payToken: 'short', holdExpiresAt: IN_10_MIN },
      { payToken: 'x'.repeat(600), holdExpiresAt: IN_10_MIN },
      { payToken: 42, holdExpiresAt: IN_10_MIN },
      { payToken: { a: 1 }, holdExpiresAt: IN_10_MIN },
      { payToken: PAY, holdExpiresAt: 'not a date' },
      { payToken: PAY, holdExpiresAt: '1999-01-01T00:00:00Z' },
      { payToken: PAY, holdExpiresAt: '2999-01-01T00:00:00Z' },
      { payToken: PAY, holdExpiresAt: 12345 },
      { payToken: PAY, holdExpiresAt: null },
    ];
    for (const over of hostile) {
      const [e] = parseStored(file(entry(over)), NOW);
      expect(e, JSON.stringify(over)).toBeDefined();
      expect(e, JSON.stringify(over)).not.toHaveProperty('payToken');
      expect(e, JSON.stringify(over)).not.toHaveProperty('holdExpiresAt');
    }
  });

  it('strips unknown fields (no card or client data can ride along)', () => {
    const [e] = parseStored(
      file({ ...entry({ payToken: PAY, holdExpiresAt: IN_10_MIN }), cardNumber: '4242', phone: '+961' }),
      NOW,
    );
    expect(e).not.toHaveProperty('cardNumber');
    expect(e).not.toHaveProperty('phone');
  });
});

describe('entryFromBooking with a deposit hold', () => {
  const base = {
    appointment: {
      reference: 'ABC234',
      startAt: '2026-11-06T08:30:00.000Z',
      endAt: '2026-11-06T09:00:00.000Z',
      service: { name: 'Haircut' },
      staff: { displayName: 'Karim' },
    },
    links: { manage: 'https://maw3ed.test/l/view-token-0001' },
  };
  const business = { slug: 'studio-nour', name: 'Studio Nour', timezone: 'Asia/Beirut' };

  it('keeps only the pay token and the hold end when the response says a deposit is due', () => {
    const e = entryFromBooking(
      { ...base, status: 'PENDING_PAYMENT', payToken: PAY, holdExpiresAt: IN_10_MIN },
      business,
      NOW,
    );
    expect(e).toMatchObject({ payToken: PAY, holdExpiresAt: IN_10_MIN });
  });

  it('adds nothing for a normal booking, a bad token, or a missing end', () => {
    expect(entryFromBooking(base, business, NOW)).not.toHaveProperty('payToken');
    expect(
      entryFromBooking({ ...base, payToken: '../x', holdExpiresAt: IN_10_MIN }, business, NOW),
    ).not.toHaveProperty('payToken');
    expect(entryFromBooking({ ...base, payToken: PAY }, business, NOW)).not.toHaveProperty('payToken');
  });
});

describe('hold rules', () => {
  it('holdMsLeft counts down and is 0 at and after the end; isHeld follows it', () => {
    const e = entry({ payToken: PAY, holdExpiresAt: IN_10_MIN });
    expect(holdMsLeft(e, NOW)).toBe(600_000);
    expect(holdMsLeft(e, new Date(NOW.getTime() + 599_000))).toBe(1000);
    expect(holdMsLeft(e, new Date(IN_10_MIN))).toBe(0);
    expect(holdMsLeft(e, new Date(NOW.getTime() + 11 * 60_000))).toBe(0);
    expect(isHeld(e, NOW)).toBe(true);
    expect(isHeld(e, new Date(IN_10_MIN))).toBe(false);
  });

  it('an entry without a hold (or an ended one) is never held', () => {
    expect(isHeld(entry(), NOW)).toBe(false);
    expect(isHeld(entry({ payToken: PAY, holdExpiresAt: IN_10_MIN, ended: 'closed' }), NOW)).toBe(false);
    expect(holdMsLeft(entry(), NOW)).toBe(0);
  });

  it('announces only at thresholds (10, 5, 2, 1 minutes, 30 s, then expiry), not every second', () => {
    const keys = new Set<string>();
    for (let ms = 600_000; ms >= 0; ms -= 1000) keys.add(holdThresholdKey(ms));
    expect([...keys].sort()).toEqual(['expired', 't1m', 't2m', 't30s', 't5m', 'tmore'].sort());
    expect(holdThresholdKey(0)).toBe('expired');
    expect(holdThresholdKey(1)).toBe('t30s');
  });
});

describe('store: clearing a hold', () => {
  class Mem implements StorageLike {
    data = new Map<string, string>();
    getItem(k: string) {
      return this.data.get(k) ?? null;
    }
    setItem(k: string, v: string) {
      this.data.set(k, v);
    }
    removeItem(k: string) {
      this.data.delete(k);
    }
  }
  const make = () => {
    const storage = new Mem();
    const store = createMyBookingsStore({ storage: () => storage, now: () => NOW });
    return { storage, store };
  };

  it('clearHold removes only payToken and holdExpiresAt and keeps the booking', () => {
    const { store, storage } = make();
    store.save(entry({ payToken: PAY, holdExpiresAt: IN_10_MIN }));
    store.clearHold('token-001');
    const [e] = store.getAll();
    expect(e?.token).toBe('token-001');
    expect(e).not.toHaveProperty('payToken');
    expect(storage.getItem(STORAGE_KEY)).not.toContain(PAY);
    expect(storage.getItem(STORAGE_KEY)).not.toContain('holdExpiresAt');
  });

  it('clearHoldByPayToken finds the entry by its pay token (after paying)', () => {
    const { store } = make();
    store.save(entry({ payToken: PAY, holdExpiresAt: IN_10_MIN }));
    store.clearHoldByPayToken(PAY);
    expect(store.getAll()[0]).not.toHaveProperty('payToken');
    expect(() => store.clearHoldByPayToken('nothing-here-1')).not.toThrow();
  });

  it('a hold lapses on its own as the injected clock passes it', () => {
    const storage = new Mem();
    let now = NOW;
    const store = createMyBookingsStore({ storage: () => storage, now: () => now });
    store.save(entry({ payToken: PAY, holdExpiresAt: IN_10_MIN }));
    expect(store.getAll()[0]).toHaveProperty('payToken');
    now = new Date(NOW.getTime() + 11 * 60_000);
    expect(store.getAll()[0]).not.toHaveProperty('payToken');
  });
});
