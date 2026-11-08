import { describe, expect, it } from 'vitest';
import { activeTab, navLinks, showTabBar, tabItems } from '@/components/public/publicNav';

describe('navLinks (header, wide screens)', () => {
  it('is Explore, How it works for a device with no saved bookings', () => {
    expect(navLinks(false).map((l) => [l.id, l.href])).toEqual([
      ['explore', '/'],
      ['how', '/how-it-works'],
    ]);
  });
  it('adds My bookings (between Explore and How it works) only when saved', () => {
    expect(navLinks(true).map((l) => [l.id, l.href])).toEqual([
      ['explore', '/'],
      ['my', '/my-bookings'],
      ['how', '/how-it-works'],
    ]);
  });
  it('has no Pricing link and no #how anchor', () => {
    const all = [...navLinks(true), ...tabItems(true)];
    expect(all.some((l) => (l.id as string) === 'pricing')).toBe(false);
    expect(all.some((l) => l.href.includes('#how') || l.href === '/pricing')).toBe(false);
  });
});

describe('tabItems (phone tab bar)', () => {
  it('is 2 tabs, then 3 with My bookings; owners is the header button, not a tab', () => {
    expect(tabItems(false).map((t) => t.id)).toEqual(['explore', 'how']);
    expect(tabItems(true).map((t) => t.id)).toEqual(['explore', 'how', 'my']);
  });
});

describe('activeTab', () => {
  it.each([
    ['/', 'explore'],
    ['/directory', 'explore'],
    ['/how-it-works', 'how'],
    ['/for-business', 'owners'],
    ['/my-bookings', 'my'],
    ['/pricing', null],
    ['/privacy', null],
    ['/b/studio-nour', null],
  ])('%s -> %s', (path, id) => expect(activeTab(path)).toBe(id));
});

describe('showTabBar', () => {
  it.each(['/', '/directory', '/how-it-works', '/for-business', '/pricing', '/privacy', '/terms', '/my-bookings'])(
    'shows on %s',
    (p) => expect(showTabBar(p)).toBe(true),
  );
  it.each(['/b/x', '/l/t', '/o/t', '/pay/t'])('hides on %s', (p) => expect(showTabBar(p)).toBe(false));
});
