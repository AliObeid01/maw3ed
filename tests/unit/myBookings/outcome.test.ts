import { describe, expect, it } from 'vitest';
import {
  OUTCOME_RECHECK_MS,
  OUTCOME_WINDOW_MS,
  outcomeTodo,
  shouldCheckOutcome,
} from '@/lib/myBookings/outcome';
import {
  STORAGE_KEY,
  createMyBookingsStore,
  parseStored,
  type SavedBooking,
  type StorageLike,
} from '@/lib/myBookings/storage';

const NOW = new Date('2026-11-08T12:00:00Z');
const H = 3_600_000;
const DAY = 24 * H;

const entry = (over: Partial<SavedBooking> = {}, startOffsetMs = -10 * DAY): SavedBooking => {
  const start = new Date(NOW.getTime() + startOffsetMs);
  return {
    token: 'token-001',
    slug: 'studio-nour',
    businessName: 'Studio Nour',
    serviceName: 'Haircut',
    staffName: 'Karim',
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
    timezone: 'Asia/Beirut',
    reference: 'ABC234',
    savedAt: new Date(start.getTime() - DAY).toISOString(),
    ...over,
  };
};

describe('shouldCheckOutcome', () => {
  it('asks for a past visit that was never checked', () => expect(shouldCheckOutcome(entry(), NOW)).toBe(true));
  it('never asks for an upcoming entry', () => {
    expect(shouldCheckOutcome(entry({}, 2 * DAY), NOW)).toBe(false);
    expect(shouldCheckOutcome(entry({}, 1), NOW)).toBe(false);
  });
  it('never asks about an entry older than 90 days, asks at the edge', () => {
    expect(shouldCheckOutcome(entry({}, -(OUTCOME_WINDOW_MS + 1)), NOW)).toBe(false);
    expect(shouldCheckOutcome(entry({}, -(OUTCOME_WINDOW_MS - 1000)), NOW)).toBe(true);
  });
  it('completed:true is cached for good: never asked again, even long after', () => {
    const done = entry({ completed: true, outcomeCheckedAt: new Date(NOW.getTime() - 80 * DAY).toISOString() });
    expect(shouldCheckOutcome(done, NOW)).toBe(false);
    expect(shouldCheckOutcome({ ...done, outcomeCheckedAt: undefined }, NOW)).toBe(false);
  });
  it('a false answer is re-checked at most every 6 hours', () => {
    const at = (ms: number) => entry({ outcomeCheckedAt: new Date(NOW.getTime() - ms).toISOString() });
    expect(shouldCheckOutcome(at(OUTCOME_RECHECK_MS - 1000), NOW)).toBe(false);
    expect(shouldCheckOutcome(at(OUTCOME_RECHECK_MS), NOW)).toBe(true);
    expect(shouldCheckOutcome(at(30 * 60_000), NOW)).toBe(false);
  });
  it('does not ask about a booking the visitor cancelled', () => {
    expect(shouldCheckOutcome(entry({ ended: 'cancelled' }), NOW)).toBe(false);
    expect(shouldCheckOutcome(entry({ ended: 'closed' }), NOW)).toBe(true);
  });
  it('treats a checked time in the future (clock change, hostile) as just checked', () => {
    expect(shouldCheckOutcome(entry({ outcomeCheckedAt: new Date(NOW.getTime() + DAY).toISOString() }), NOW)).toBe(false);
  });
});

describe('outcomeTodo', () => {
  it('lists the tokens to ask for, each once, newest visit first', () => {
    const list = [
      entry({ token: 'token-old' }, -40 * DAY),
      entry({ token: 'token-new' }, -2 * DAY),
      entry({ token: 'token-up' }, 3 * DAY),
      entry({ token: 'token-done', completed: true }, -5 * DAY),
      entry({ token: 'token-new', reference: 'XYZ999' }, -2 * DAY),
    ];
    expect(outcomeTodo(list, NOW)).toEqual(['token-new', 'token-old']);
  });
});

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

describe('storage: completed and outcomeCheckedAt', () => {
  const raw = (entries: unknown[], v = 1) => JSON.stringify({ v, entries });

  it('reads v1 data with no new fields (backwards compatible)', () => {
    const list = parseStored(raw([entry()]), NOW);
    expect(list).toHaveLength(1);
    expect(list[0]!.completed).toBeUndefined();
    expect(list[0]!.outcomeCheckedAt).toBeUndefined();
  });
  it('keeps a valid completed:true and checked time', () => {
    const at = new Date(NOW.getTime() - H).toISOString();
    const [first] = parseStored(raw([entry({ completed: true, outcomeCheckedAt: at })]), NOW);
    expect(first!.completed).toBe(true);
    expect(first!.outcomeCheckedAt).toBe(at);
  });
  it.each([false, 'yes', 1, null, {}, []])('hostile completed %j is dropped, the entry survives', (bad) => {
    const [first] = parseStored(raw([{ ...entry(), completed: bad }]), NOW);
    expect(first).toBeTruthy();
    expect(first!.completed).toBeUndefined();
  });
  it.each(['not a date', '1999-01-01T00:00:00Z', 12, {}, 'x'.repeat(500)])('hostile outcomeCheckedAt %j is dropped', (bad) => {
    const [first] = parseStored(raw([{ ...entry(), outcomeCheckedAt: bad }]), NOW);
    expect(first).toBeTruthy();
    expect(first!.outcomeCheckedAt).toBeUndefined();
  });
  it('strips fields it does not know even next to the new ones', () => {
    const [first] = parseStored(raw([{ ...entry({ completed: true }), name: 'Rami', phone: '+96170000000' }]), NOW);
    expect(Object.keys(first!).sort()).not.toContain('name');
    expect(Object.keys(first!).sort()).not.toContain('phone');
  });
});

describe('store.markOutcome', () => {
  const make = () => {
    const mem = new Mem();
    let now = NOW;
    const store = createMyBookingsStore({ storage: () => mem, now: () => now });
    store.save(entry());
    return { mem, store, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
  };

  it('completed:true is stored with the check time', () => {
    const { store } = make();
    store.markOutcome('token-001', true);
    const [e] = store.getAll();
    expect(e!.completed).toBe(true);
    expect(e!.outcomeCheckedAt).toBe(NOW.toISOString());
  });
  it('false only records when it was asked (no completed flag)', () => {
    const { store } = make();
    store.markOutcome('token-001', false);
    const [e] = store.getAll();
    expect(e!.completed).toBeUndefined();
    expect(e!.outcomeCheckedAt).toBe(NOW.toISOString());
  });
  it('a later false never erases completed:true', () => {
    const { store, advance } = make();
    store.markOutcome('token-001', true);
    advance(7 * H);
    store.markOutcome('token-001', false);
    expect(store.getAll()[0]!.completed).toBe(true);
  });
  it('persists in the versioned key and ignores an unknown token', () => {
    const { store, mem } = make();
    store.markOutcome('nope-nope', true);
    expect(store.getAll()[0]!.completed).toBeUndefined();
    store.markOutcome('token-001', true);
    expect(JSON.parse(mem.getItem(STORAGE_KEY)!).v).toBe(1);
    expect(JSON.parse(mem.getItem(STORAGE_KEY)!).entries[0].completed).toBe(true);
  });
  it('does not rewrite storage when nothing changes', () => {
    const { store, mem } = make();
    store.markOutcome('token-001', true);
    let writes = 0;
    const set = mem.setItem.bind(mem);
    mem.setItem = (k, v) => {
      writes += 1;
      set(k, v);
    };
    store.markOutcome('token-001', true);
    expect(writes).toBe(0);
  });
});
