import { describe, expect, it } from 'vitest';
import ar from '../../../messages/ar.json';
import en from '../../../messages/en.json';

type Tree = {
  directory: { explore: Record<string, string> };
  home: { categories: Record<string, unknown>; nextFree: Record<string, string> };
  public: { footer: { owners: string } };
};
const trees: Record<string, Tree> = { en: en as unknown as Tree, ar: ar as unknown as Tree };

describe.each(['en', 'ar'])('PR-12 cosmetic copy (%s)', (locale) => {
  const m = trees[locale]!;

  it('Explore cards and home cards use the same "Free times for <service>" phrase and day words', () => {
    expect(m.directory.explore.freeTimesFor).toBe(m.home.categories.freeTimesFor);
    expect(m.directory.explore.dayToday).toBe(m.home.nextFree.today);
    expect(m.directory.explore.dayTomorrow).toBe(m.home.nextFree.tomorrow);
  });

  it('the old "Free today / for <service>" keys are gone, so the two wordings cannot drift apart again', () => {
    for (const key of ['freeToday', 'freeTomorrow', 'freeOn', 'forService'])
      expect(m.directory.explore, key).not.toHaveProperty(key);
  });

  it('keeps the true-copy rule: never a no-availability or fully-booked claim', () => {
    const text = JSON.stringify([m.directory.explore, m.home.categories]);
    expect(text).not.toMatch(/fully booked|no availability|sold out|محجوز بالكامل|لا توجد مواعيد/i);
  });

  it('the footer heading for owners and the Explore placeholder are short enough for a 320 px phone', () => {
    // Footer column at 320 px is about 130 px wide at 16 px semibold: about 15 characters in Latin, 18 in Arabic.
    expect([...m.public.footer.owners].length).toBeLessThanOrEqual(locale === 'en' ? 15 : 18);
    // Search field at 320 px shows about 24 characters at 15 px.
    expect([...(m.directory.explore.searchPlaceholder ?? '')].length).toBeLessThanOrEqual(24);
  });
});
