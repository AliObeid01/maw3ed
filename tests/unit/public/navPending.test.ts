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
