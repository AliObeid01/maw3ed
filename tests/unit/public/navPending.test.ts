import { describe, expect, it } from 'vitest';
import { beginNavigation, navigationPending, subscribeNavigation } from '@/lib/navPending';

describe('navPending store', () => {
  it('is pending while any navigation is in flight and notifies subscribers', () => {
    let calls = 0;
    const off = subscribeNavigation(() => (calls += 1));
    expect(navigationPending()).toBe(false);
    const a = beginNavigation();
    const b = beginNavigation();
    expect(navigationPending()).toBe(true);
    a();
    expect(navigationPending()).toBe(true);
    b();
    expect(navigationPending()).toBe(false);
    expect(calls).toBe(4);
    off();
  });
  it('an unsubscribed listener is never called again (PR-12: survived a mutation before)', () => {
    let calls = 0;
    const off = subscribeNavigation(() => (calls += 1));
    const end = beginNavigation();
    expect(calls).toBe(1);
    off();
    end();
    beginNavigation()();
    expect(calls).toBe(1);
    expect(navigationPending()).toBe(false);
  });
  it('a listener that unsubscribes itself while being notified does not make another listener miss the event', () => {
    let second = 0;
    const offFirst = subscribeNavigation(() => offFirst());
    const offSecond = subscribeNavigation(() => (second += 1));
    beginNavigation()();
    expect(second).toBe(2);
    offSecond();
  });
  it('a listener added during a notification is called from the next event on, not in this one', () => {
    let late = 0;
    let offLate: (() => void) | undefined;
    const offFirst = subscribeNavigation(() => {
      offLate ??= subscribeNavigation(() => (late += 1));
    });
    const end = beginNavigation();
    expect(late).toBe(0);
    end();
    expect(late).toBe(1);
    offFirst();
    offLate?.();
  });
  it('the snapshot is stable between events (useSyncExternalStore requires it)', () => {
    const end = beginNavigation();
    expect(navigationPending()).toBe(navigationPending());
    end();
  });
  it('ending twice does not go below zero or end another navigation', () => {
    const a = beginNavigation();
    const b = beginNavigation();
    a();
    a();
    expect(navigationPending()).toBe(true);
    b();
    expect(navigationPending()).toBe(false);
  });
});
