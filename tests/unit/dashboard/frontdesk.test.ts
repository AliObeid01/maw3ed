import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientHit } from '@/lib/api/dashboard';
import { earliestSlot } from '@/lib/frontdesk/walkin';
import { createLookup, pickClient, type LookupState } from '@/lib/frontdesk/lookup';

const slot = (startAt: string) => ({ startAt, endAt: startAt });

describe('earliestSlot', () => {
  const now = new Date('2026-10-29T08:07:00Z');
  it('picks the first slot at or after now, whatever the order', () => {
    const slots = [
      slot('2026-10-29T09:00:00Z'),
      slot('2026-10-29T07:45:00Z'),
      slot('2026-10-29T08:15:00Z'),
      slot('2026-10-30T07:00:00Z'),
    ];
    expect(earliestSlot(slots, now)?.startAt).toBe('2026-10-29T08:15:00Z');
  });
  it('includes a slot starting exactly now', () => {
    expect(earliestSlot([slot('2026-10-29T08:07:00Z')], now)).toBeDefined();
  });
  it('is undefined when everything is in the past or empty', () => {
    expect(earliestSlot([slot('2026-10-29T07:00:00Z')], now)).toBeUndefined();
    expect(earliestSlot([], now)).toBeUndefined();
  });
});

const hit = (phone: string, name = 'Maya Haddad', noShows = 2): ClientHit => ({
  id: 'c1',
  name,
  phone,
  noShows,
  visits: undefined,
});

describe('pickClient', () => {
  it('requires the full number to match, not just a prefix', () => {
    expect(pickClient([hit('+96170555218')], '+96170555218')?.name).toBe('Maya Haddad');
    expect(pickClient([hit('+96170555218')], '+9617055521')).toBeUndefined();
    expect(pickClient([], '+96170555218')).toBeUndefined();
  });
});

describe('createLookup', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (search: Parameters<typeof createLookup>[0]['search']) => {
    const states: LookupState[] = [];
    const lookup = createLookup({ search, onState: (s) => states.push(s), delayMs: 300 });
    return { states, lookup, last: () => states[states.length - 1] };
  };

  it('debounces: only the last input is searched', async () => {
    const search = vi.fn().mockResolvedValue([hit('+96170555218')]);
    const { lookup, last } = setup(search);
    lookup.input('+9617055521');
    await vi.advanceTimersByTimeAsync(100);
    lookup.input('+96170555218');
    await vi.advanceTimersByTimeAsync(300);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]![0]).toBe('96170555218');
    expect(last()).toMatchObject({ status: 'found' });
  });

  it('does not search short input and resets to idle', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const { lookup, last } = setup(search);
    lookup.input('+9617');
    await vi.advanceTimersByTimeAsync(1000);
    expect(search).not.toHaveBeenCalled();
    expect(last()).toEqual({ status: 'idle' });
  });

  it('drops a slow response for an older number', async () => {
    let resolveOld!: (v: ClientHit[]) => void;
    const search = vi
      .fn()
      .mockImplementationOnce(() => new Promise<ClientHit[]>((r) => (resolveOld = r)))
      .mockResolvedValueOnce([hit('+96171111111', 'New Person', 0)]);
    const { lookup, last } = setup(search);
    lookup.input('+96170555218');
    await vi.advanceTimersByTimeAsync(300);
    lookup.input('+96171111111');
    await vi.advanceTimersByTimeAsync(300);
    resolveOld([hit('+96170555218')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(last()).toMatchObject({ status: 'found', client: { name: 'New Person' } });
  });

  it('shortening the number after a hit clears it, even if the old response arrives later', async () => {
    let resolveOld!: (v: ClientHit[]) => void;
    const search = vi.fn().mockImplementationOnce(() => new Promise<ClientHit[]>((r) => (resolveOld = r)));
    const { lookup, last } = setup(search);
    lookup.input('+96170555218');
    await vi.advanceTimersByTimeAsync(300);
    lookup.input('+961');
    resolveOld([hit('+96170555218')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(last()).toEqual({ status: 'idle' });
  });

  it('a failed search is "none", not an error', async () => {
    const { lookup, last } = setup(vi.fn().mockRejectedValue(new Error('boom')));
    lookup.input('+96170555218');
    await vi.advanceTimersByTimeAsync(300);
    expect(last()).toEqual({ status: 'none' });
  });

  it('dispose stops pending work', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const { lookup } = setup(search);
    lookup.input('+96170555218');
    lookup.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(search).not.toHaveBeenCalled();
  });
});
