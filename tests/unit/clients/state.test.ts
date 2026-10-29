import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientPage, ClientRow } from '@/lib/api/outcomes';
import { createDebounced } from '@/lib/clients/debounce';
import { initialList, listReducer, mergePage, type ListEvent } from '@/lib/clients/state';

const row = (id: string): ClientRow => ({
  id,
  name: `Client ${id}`,
  phone: '+96170555218',
  email: null,
  attended: 1,
  noShows: 0,
  lateCancels: 0,
  lastVisitAt: null,
  repeatNoShow: false,
});
const page = (ids: string[], nextCursor: string | null = null): ClientPage => ({
  clients: ids.map(row),
  nextCursor,
});
const run = (events: ListEvent[], from = initialList) => events.reduce(listReducer, from);

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires once after the quiet period with the last value', () => {
    const fn = vi.fn();
    const d = createDebounced(fn, 300);
    d.call('n');
    vi.advanceTimersByTime(200);
    d.call('na');
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('na');
  });
  it('flush runs the waiting call immediately, once', () => {
    const fn = vi.fn();
    const d = createDebounced(fn, 300);
    d.call('x');
    d.flush();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('cancel drops it', () => {
    const fn = vi.fn();
    const d = createDebounced(fn, 300);
    d.call('x');
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('clients list state', () => {
  it('a filter change starts a new request generation; same filter is a no-op', () => {
    const s = run([{ type: 'filter', search: ' Maya ', sort: 'name' }]);
    expect(s).toMatchObject({ seq: 1, search: 'Maya', status: 'loading' });
    expect(listReducer(s, { type: 'filter', search: 'Maya', sort: 'name' })).toBe(s);
  });

  it('drops a response to an older search (stale responses)', () => {
    const s = run([
      { type: 'filter', search: 'ma', sort: 'name' }, // seq 1
      { type: 'filter', search: 'maya', sort: 'name' }, // seq 2
      { type: 'loaded', seq: 2, page: page(['maya']) },
      { type: 'loaded', seq: 1, page: page(['mark', 'mario']) }, // arrives late
    ]);
    expect(s.items.map((c) => c.id)).toEqual(['maya']);
    expect(s.status).toBe('ready');
  });

  it('a stale failure does not replace newer results', () => {
    const s = run([
      { type: 'filter', search: 'a', sort: 'name' },
      { type: 'filter', search: 'ab', sort: 'name' },
      { type: 'loaded', seq: 2, page: page(['1']) },
      { type: 'failed', seq: 1, error: new Error('x') },
    ]);
    expect(s.status).toBe('ready');
  });

  it('load more appends, skips duplicates and stores the next cursor', () => {
    const s = run([
      { type: 'loaded', seq: 0, page: page(['1', '2'], 'c1') },
      { type: 'loadMore' },
      { type: 'moreLoaded', seq: 0, page: page(['2', '3'], null) },
    ]);
    expect(s.items.map((c) => c.id)).toEqual(['1', '2', '3']);
    expect(s.nextCursor).toBeNull();
    expect(s.loadingMore).toBe(false);
  });

  it('load more is ignored without a cursor or while already loading (no double fetch)', () => {
    const noCursor = run([{ type: 'loaded', seq: 0, page: page(['1']) }]);
    expect(listReducer(noCursor, { type: 'loadMore' })).toBe(noCursor);
    const loading = run([
      { type: 'loaded', seq: 0, page: page(['1'], 'c') },
      { type: 'loadMore' },
    ]);
    expect(listReducer(loading, { type: 'loadMore' })).toBe(loading);
  });

  it('a page that was loading more when the filter changed is discarded', () => {
    const s = run([
      { type: 'loaded', seq: 0, page: page(['1'], 'c') },
      { type: 'loadMore' },
      { type: 'filter', search: 'x', sort: 'name' },
      { type: 'moreLoaded', seq: 0, page: page(['9']) },
    ]);
    expect(s.items.map((c) => c.id)).toEqual(['1']);
    expect(s.loadingMore).toBe(false);
  });

  it('a failed load more keeps the rows and flags it; retry restarts the list', () => {
    const s = run([
      { type: 'loaded', seq: 0, page: page(['1'], 'c') },
      { type: 'loadMore' },
      { type: 'moreFailed', seq: 0 },
    ]);
    expect(s).toMatchObject({ moreFailed: true, loadingMore: false });
    expect(s.items).toHaveLength(1);
    const failed = run([{ type: 'failed', seq: 0, error: new Error('x') }]);
    expect(failed.status).toBe('error');
    expect(listReducer(failed, { type: 'retry' })).toMatchObject({ status: 'loading', seq: 1 });
  });

  it('mergePage keeps order and ignores repeats', () => {
    expect(mergePage([row('1')], [row('1'), row('2')]).map((c) => c.id)).toEqual(['1', '2']);
  });
});
