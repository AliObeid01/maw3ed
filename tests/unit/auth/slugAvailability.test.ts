import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlugCheck } from '@/lib/api/auth';
import {
  deriveSlugStatus,
  needsServerCheck,
  scheduleSlugCheck,
  type SlugStatus,
} from '@/lib/auth/slugAvailability';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('scheduleSlugCheck', () => {
  it('waits for the debounce before calling the server', async () => {
    const check = vi.fn(async () => ({ available: true }) as SlugCheck);
    const onResult = vi.fn();
    scheduleSlugCheck('studio-nour', check, onResult, 400);
    await vi.advanceTimersByTimeAsync(399);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith('studio-nour', 'available');
  });

  it('typing again cancels the pending check (only the last slug is checked)', async () => {
    const check = vi.fn(async () => ({ available: true }) as SlugCheck);
    const onResult = vi.fn();
    const cancel = scheduleSlugCheck('studio', check, onResult, 400);
    await vi.advanceTimersByTimeAsync(200);
    cancel();
    scheduleSlugCheck('studio-nour', check, onResult, 400);
    await vi.advanceTimersByTimeAsync(1000);
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith('studio-nour', expect.any(AbortSignal));
  });

  it('aborts the in-flight request on change and ignores its late response', async () => {
    const first = deferred<SlugCheck>();
    let signal!: AbortSignal;
    const check = vi.fn((_slug: string, s: AbortSignal) => {
      signal = s;
      return first.promise;
    });
    const onResult = vi.fn();
    const cancel = scheduleSlugCheck('old-slug', check, onResult, 400);
    await vi.advanceTimersByTimeAsync(400);
    expect(signal.aborted).toBe(false);
    cancel();
    expect(signal.aborted).toBe(true);
    first.resolve({ available: false, reason: 'taken' });
    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).not.toHaveBeenCalled();
  });

  it('maps reasons and defaults an unavailable slug without a reason to taken', async () => {
    const results: SlugStatus[] = [];
    for (const reply of [{ available: false, reason: 'reserved' as const }, { available: false }]) {
      scheduleSlugCheck(
        'abc',
        async () => reply,
        (_s, status) => results.push(status),
        0,
      );
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(results).toEqual(['reserved', 'taken']);
  });

  it('reports unknown when the check fails (not an error state, the server re-checks on submit)', async () => {
    const onResult = vi.fn();
    scheduleSlugCheck('abc', () => Promise.reject(new Error('net')), onResult, 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).toHaveBeenCalledWith('abc', 'unknown');
  });

  it('stays silent when a failure arrives after cancel', async () => {
    const d = deferred<SlugCheck>();
    const onResult = vi.fn();
    const cancel = scheduleSlugCheck('abc', () => d.promise, onResult, 0);
    await vi.advanceTimersByTimeAsync(0);
    cancel();
    d.reject(new DOMException('aborted', 'AbortError'));
    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).not.toHaveBeenCalled();
  });
});

describe('deriveSlugStatus', () => {
  it('handles local cases without the network', () => {
    expect(deriveSlugStatus('', null)).toBe('idle');
    expect(deriveSlugStatus('ab', null)).toBe('invalid');
    expect(deriveSlugStatus('admin', null)).toBe('reserved');
    expect(needsServerCheck('admin')).toBe(false);
    expect(needsServerCheck('ab')).toBe(false);
    expect(needsServerCheck('studio-nour')).toBe(true);
  });

  it('treats a result for an older slug as stale (checking)', () => {
    const result = { slug: 'old-slug', status: 'taken' as const };
    expect(deriveSlugStatus('new-slug', result)).toBe('checking');
    expect(deriveSlugStatus('old-slug', result)).toBe('taken');
  });
});
