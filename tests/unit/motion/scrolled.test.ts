import { describe, expect, it } from 'vitest';
import { isScrolled, SCROLLED_AFTER, tabIndicator } from '@/lib/motion/scrolled';

describe('isScrolled (header shadow)', () => {
  it('is off at the top and within a few pixels, on after the threshold', () => {
    expect(isScrolled(0)).toBe(false);
    expect(isScrolled(SCROLLED_AFTER)).toBe(false);
    expect(isScrolled(SCROLLED_AFTER + 1)).toBe(true);
    expect(isScrolled(2000)).toBe(true);
  });
  it('treats negative overscroll (iOS bounce) and bad values as top', () => {
    expect(isScrolled(-40)).toBe(false);
    expect(isScrolled(Number.NaN)).toBe(false);
  });
});

describe('tabIndicator (phone tab bar slide)', () => {
  it('gives the index and count of the active tab, so a single bar can slide with transform', () => {
    expect(tabIndicator(['explore', 'how', 'my'], 'how')).toEqual({ index: 1, count: 3 });
    expect(tabIndicator(['explore', 'how'], 'explore')).toEqual({ index: 0, count: 2 });
  });
  it('hides the bar when the current page is not one of the tabs', () => {
    expect(tabIndicator(['explore', 'how'], 'owners')).toBeNull();
    expect(tabIndicator(['explore', 'how'], null)).toBeNull();
  });
});
