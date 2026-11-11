import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClock } from '@/lib/home/useNow';

const fakeDoc = () => ({ visibilityState: 'visible', addEventListener: () => undefined, removeEventListener: () => undefined }) as never;

describe('createClock', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ticks every period for all subscribers with ONE interval and stops with the last one', () => {
    let t = 1000;
    const clock = createClock(60_000, () => t, fakeDoc());
    const a = vi.fn();
    const b = vi.fn();
    const offA = clock.subscribe(a);
    const offB = clock.subscribe(b);
    expect(vi.getTimerCount()).toBe(1);
    t = 61_000;
    vi.advanceTimersByTime(60_000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(clock.snapshot()).toBe(61_000);
    offA();
    expect(vi.getTimerCount()).toBe(1);
    offB();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pauses while the tab is hidden and catches up when it is visible again', () => {
    let t = 0;
    let onChange: () => void = () => undefined;
    const doc = {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: (_: string, fn: () => void) => void (onChange = fn),
      removeEventListener: () => undefined,
    };
    const clock = createClock(60_000, () => t, doc as never);
    const listener = vi.fn();
    const off = clock.subscribe(listener);
    doc.visibilityState = 'hidden';
    onChange();
    expect(vi.getTimerCount()).toBe(0);
    t = 500_000;
    doc.visibilityState = 'visible';
    onChange();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(clock.snapshot()).toBe(500_000);
    expect(vi.getTimerCount()).toBe(1);
    off();
  });
});
