import { describe, expect, it } from 'vitest';
import { createInMemoryThrottle, MAX_KEYS, WINDOW_MS } from '@/server/services/loginThrottle';

const T0 = new Date('2026-11-01T10:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

describe('login throttle', () => {
  it('locks after 5 failures in 15 minutes, per key', () => {
    const t = createInMemoryThrottle();
    for (let i = 0; i < 4; i++) t.recordFailure('a@x.com', at(i * 1000));
    expect(t.retryAfterSec('a@x.com', at(5000))).toBe(0);
    t.recordFailure('a@x.com', at(5000));
    expect(t.retryAfterSec('a@x.com', at(6000))).toBeGreaterThan(0);
    expect(t.retryAfterSec('b@x.com', at(6000))).toBe(0);
  });

  it('forgets failures after the window and on success', () => {
    const t = createInMemoryThrottle();
    for (let i = 0; i < 5; i++) t.recordFailure('a@x.com', at(0));
    expect(t.retryAfterSec('a@x.com', at(WINDOW_MS - 1))).toBeGreaterThan(0);
    expect(t.retryAfterSec('a@x.com', at(WINDOW_MS + 1))).toBe(0);
    for (let i = 0; i < 5; i++) t.recordFailure('c@x.com', at(0));
    t.clear('c@x.com');
    expect(t.retryAfterSec('c@x.com', at(1))).toBe(0);
  });

  it('evicts expired entries so the map cannot grow without bound', () => {
    const t = createInMemoryThrottle();
    for (let i = 0; i < 500; i++) t.recordFailure(`old${i}@x.com`, at(0));
    expect(t.size()).toBe(500);
    t.recordFailure('new@x.com', at(WINDOW_MS + 1));
    expect(t.size()).toBe(1);
  });

  it('caps the number of live keys', () => {
    const t = createInMemoryThrottle();
    for (let i = 0; i < MAX_KEYS + 50; i++) t.recordFailure(`k${i}@x.com`, at(i));
    expect(t.size()).toBeLessThanOrEqual(MAX_KEYS + 1);
  });
});
