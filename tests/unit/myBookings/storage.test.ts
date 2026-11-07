import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_ENTRIES,
  STORAGE_KEY,
  createMyBookingsStore,
  entryFromBooking,
  parseStored,
  tokenFromManageLink,
  type SavedBooking,
  type StorageLike,
} from '@/lib/myBookings/storage';

const NOW = new Date('2026-11-04T08:00:00Z');
const DAY = 86_400_000;

const entry = (over: Partial<SavedBooking> = {}): SavedBooking => ({
  token: 'tok-1',
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

class MemoryStorage implements StorageLike {
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

type Listener = (e: { key: string | null }) => void;
class Target {
  listeners = new Set<Listener>();
  addEventListener(_t: 'storage', fn: Listener) {
    this.listeners.add(fn);
  }
  removeEventListener(_t: 'storage', fn: Listener) {
    this.listeners.delete(fn);
  }
  fire(key: string | null) {
    for (const l of this.listeners) l({ key });
  }
}

function make(storage: StorageLike | undefined, target = new Target()) {
  let now = NOW;
  const store = createMyBookingsStore({ storage: () => storage, now: () => now, target });
  return { store, target, setNow: (d: Date) => (now = d) };
}

describe('parseStored', () => {
  it('returns an empty list for null, empty or corrupt JSON and never throws', () => {
    expect(parseStored(null, NOW)).toEqual([]);
    expect(parseStored('', NOW)).toEqual([]);
    expect(parseStored('{not json', NOW)).toEqual([]);
    expect(parseStored('"a string"', NOW)).toEqual([]);
    expect(parseStored('{"v":2,"entries":[]}', NOW)).toEqual([]);
    expect(parseStored('{"v":1}', NOW)).toEqual([]);
  });

  it('drops bad entries and keeps the good ones', () => {
    const raw = JSON.stringify({
      v: 1,
      entries: [
        entry(),
        { token: 5 },
        null,
        'x',
        entry({ token: 'tok-2', startAt: 'nope' }),
        entry({ token: 'tok-3', reference: 'DEF567' }),
      ],
    });
    expect(
      parseStored(raw, NOW)
        .map((e) => e.token)
        .sort(),
    ).toEqual(['tok-1', 'tok-3']);
  });

  it('strips unknown fields so a name, phone or email can never ride along', () => {
    const raw = JSON.stringify({
      v: 1,
      entries: [{ ...entry(), clientName: 'Rana', phone: '+96170000000', email: 'a@b.test' }],
    });
    const [only] = parseStored(raw, NOW);
    expect(Object.keys(only!).sort()).toEqual(
      [
        'businessName',
        'endAt',
        'reference',
        'savedAt',
        'serviceName',
        'slug',
        'staffName',
        'startAt',
        'timezone',
        'token',
      ].sort(),
    );
  });

  it('de-duplicates by token and by slug + reference, newest save wins', () => {
    const raw = JSON.stringify({
      v: 1,
      entries: [
        entry({ token: 'a', reference: 'XYZ', savedAt: '2026-11-01T00:00:00Z', serviceName: 'Old' }),
        entry({ token: 'b', reference: 'XYZ', savedAt: '2026-11-02T00:00:00Z', serviceName: 'New' }),
        entry({ token: 'b', reference: null, savedAt: '2026-11-01T12:00:00Z', serviceName: 'Older b' }),
        entry({ token: 'c', slug: 'other', reference: 'XYZ', serviceName: 'Other business' }),
      ],
    });
    const out = parseStored(raw, NOW);
    expect(out.map((e) => e.serviceName).sort()).toEqual(['New', 'Other business']);
  });

  it('drops entries more than 90 days past their start, keeps the ones at the edge', () => {
    const edge = new Date(NOW.getTime() - 90 * DAY + 1000).toISOString();
    const old = new Date(NOW.getTime() - 90 * DAY - 1000).toISOString();
    const raw = JSON.stringify({
      v: 1,
      entries: [
        entry({ token: 'edge', startAt: edge, reference: 'E1' }),
        entry({ token: 'old', startAt: old, reference: 'O1' }),
      ],
    });
    expect(parseStored(raw, NOW).map((e) => e.token)).toEqual(['edge']);
  });

  it('caps at 20, keeping the most recently saved', () => {
    const entries = Array.from({ length: 25 }, (_, i) =>
      entry({
        token: `t${i}`,
        reference: `R${i}`,
        savedAt: new Date(NOW.getTime() - (25 - i) * 1000).toISOString(),
      }),
    );
    const out = parseStored(JSON.stringify({ v: 1, entries }), NOW);
    expect(out).toHaveLength(MAX_ENTRIES);
    expect(out.map((e) => e.token)).not.toContain('t0');
    expect(out.map((e) => e.token)).toContain('t24');
  });

  it('keeps a valid ended marker and drops an invalid one', () => {
    const raw = JSON.stringify({
      v: 1,
      entries: [
        entry({ token: 'a', reference: 'A1', ended: 'cancelled' }),
        entry({ token: 'b', reference: 'B1', ended: 'weird' as never }),
      ],
    });
    const out = parseStored(raw, NOW);
    expect(out.find((e) => e.token === 'a')?.ended).toBe('cancelled');
    expect(out.find((e) => e.token === 'b')?.ended).toBeUndefined();
  });
});

describe('createMyBookingsStore', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('saves under the versioned key and reads back', () => {
    const { store } = make(storage);
    expect(store.save(entry())).toBe(true);
    expect(STORAGE_KEY).toBe('maw3ed:myBookings:v1');
    expect(storage.getItem(STORAGE_KEY)).toContain('tok-1');
    expect(store.getAll().map((e) => e.token)).toEqual(['tok-1']);
    expect(store.count()).toBe(1);
  });

  it('saving the same booking twice keeps one entry', () => {
    const { store } = make(storage);
    store.save(entry());
    store.save(entry({ serviceName: 'Haircut + beard' }));
    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0]!.serviceName).toBe('Haircut + beard');
  });

  it('getAll returns the same reference while nothing changed (useSyncExternalStore)', () => {
    const { store } = make(storage);
    store.save(entry());
    expect(store.getAll()).toBe(store.getAll());
    const before = store.getAll();
    store.save(entry({ token: 'tok-2', reference: 'ZZZ999' }));
    expect(store.getAll()).not.toBe(before);
  });

  it('notifies subscribers on same-tab writes and stops after unsubscribe', () => {
    const { store } = make(storage);
    let calls = 0;
    const off = store.subscribe(() => (calls += 1));
    store.save(entry());
    store.markEnded('tok-1', 'cancelled');
    expect(calls).toBe(2);
    off();
    store.clear();
    expect(calls).toBe(2);
  });

  it('notifies on a storage event from another tab for our key (and for clear())', () => {
    const { store, target } = make(storage);
    let calls = 0;
    store.subscribe(() => (calls += 1));
    storage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, entries: [entry({ token: 'from-other-tab' })] }));
    target.fire(STORAGE_KEY);
    expect(calls).toBe(1);
    expect(store.getAll().map((e) => e.token)).toEqual(['from-other-tab']);
    target.fire('unrelated');
    expect(calls).toBe(1);
    storage.removeItem(STORAGE_KEY);
    target.fire(null);
    expect(calls).toBe(2);
    expect(store.getAll()).toEqual([]);
  });

  it('removes the storage listener when the last subscriber leaves', () => {
    const { store, target } = make(storage);
    const off = store.subscribe(() => undefined);
    expect(target.listeners.size).toBe(1);
    off();
    expect(target.listeners.size).toBe(0);
  });

  it('markEnded keeps the summary and flags it; clear removes everything', () => {
    const { store } = make(storage);
    store.save(entry());
    store.markEnded('tok-1', 'closed');
    expect(store.getAll()[0]!.ended).toBe('closed');
    store.clear();
    expect(store.getAll()).toEqual([]);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('prunes by the injected clock', () => {
    const { store, setNow } = make(storage);
    store.save(entry());
    setNow(new Date(Date.parse(entry().startAt) + 91 * DAY));
    expect(store.getAll()).toEqual([]);
  });

  it('is empty and silent when there is no storage at all (SSR, blocked)', () => {
    const { store } = make(undefined);
    expect(store.getAll()).toEqual([]);
    expect(store.save(entry())).toBe(false);
    expect(store.availability()).toBe('blocked');
    expect(() => store.clear()).not.toThrow();
    expect(() => store.markEnded('x', 'closed')).not.toThrow();
  });

  it('survives every call throwing (blocked storage)', () => {
    const deny = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    const { store } = make({ getItem: deny, setItem: deny, removeItem: deny });
    expect(store.getAll()).toEqual([]);
    expect(store.save(entry())).toBe(false);
    expect(store.availability()).toBe('blocked');
    expect(() => store.clear()).not.toThrow();
  });

  it('survives the storage getter itself throwing', () => {
    const store = createMyBookingsStore({
      storage: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      now: () => NOW,
      target: new Target(),
    });
    expect(store.getAll()).toEqual([]);
    expect(store.availability()).toBe('blocked');
  });

  it('on a quota error retries with fewer entries, then gives up quietly', () => {
    let limit = 3;
    const small: StorageLike = {
      getItem: (k) => storage.getItem(k),
      setItem: (k, v) => {
        if ((JSON.parse(v) as { entries: unknown[] }).entries.length > limit)
          throw new DOMException('full', 'QuotaExceededError');
        storage.setItem(k, v);
      },
      removeItem: (k) => storage.removeItem(k),
    };
    const { store } = make(small);
    for (let i = 0; i < 6; i += 1)
      store.save(
        entry({ token: `t${i}`, reference: `R${i}`, savedAt: new Date(NOW.getTime() + i * 1000).toISOString() }),
      );
    expect(store.getAll().length).toBeLessThanOrEqual(3);
    expect(store.getAll().map((e) => e.token)).toContain('t5');
    limit = 0;
    expect(store.save(entry({ token: 'late', reference: 'LATE11' }))).toBe(false);
  });

  it('availability is ok on working storage and the probe leaves nothing behind', () => {
    expect(make(storage).store.availability()).toBe('ok');
    expect(storage.data.size).toBe(0);
  });

  it('tolerates corrupted stored JSON and recovers on the next save', () => {
    storage.setItem(STORAGE_KEY, '{{{{');
    const { store } = make(storage);
    expect(store.getAll()).toEqual([]);
    store.save(entry());
    expect(store.getAll()).toHaveLength(1);
  });
});

describe('tokenFromManageLink / entryFromBooking', () => {
  it('takes the token from the last path segment of the manage link', () => {
    expect(tokenFromManageLink('https://maw3ed.example/l/abc.def-ghi')).toBe('abc.def-ghi');
    expect(tokenFromManageLink('/l/mock-manage-token')).toBe('mock-manage-token');
    expect(tokenFromManageLink('/l/tok?x=1#h')).toBe('tok');
    expect(tokenFromManageLink('')).toBeUndefined();
    expect(tokenFromManageLink('https://x.test/')).toBeUndefined();
  });

  const result = (manage: string, reference: string | null = 'ABC234') => ({
    appointment: {
      id: 'a1',
      reference,
      startAt: '2026-11-06T08:30:00.000Z',
      endAt: '2026-11-06T09:00:00.000Z',
      status: 'BOOKED',
      service: { id: 's', name: 'Haircut', durationMin: 30, price: 15 },
      staff: { id: 'st', displayName: 'Karim' },
    },
    links: { manage },
  });
  const business = { slug: 'studio-nour', name: 'Studio Nour', timezone: 'Asia/Beirut' };

  it('builds an entry without any client identity', () => {
    const e = entryFromBooking(result('https://x.test/l/tok-9'), business, NOW);
    expect(e).toMatchObject({
      token: 'tok-9',
      slug: 'studio-nour',
      serviceName: 'Haircut',
      staffName: 'Karim',
      reference: 'ABC234',
    });
    expect(e?.savedAt).toBe(NOW.toISOString());
    expect(Object.keys(e!)).not.toEqual(expect.arrayContaining(['phone']));
    expect(JSON.stringify(e)).not.toMatch(/phone|email|client/i);
  });

  it('returns undefined when there is no usable token', () => {
    expect(entryFromBooking(result(''), business, NOW)).toBeUndefined();
  });
});
