import { describe, expect, it } from 'vitest';
import {
  HOME_CATEGORIES,
  headingKey,
  listedCategories,
  resolveSelected,
} from '@/lib/home/categories';
import { heroChips } from '@/lib/home/popular';
import { chipTime } from '@/lib/home/freeTimes';
import { directorySchema } from '@/lib/api/directory';
import { homeDirectoryUrl, nextFreePanelUrl } from '@/lib/api/home';

const entry = (category: string, places: number, popular: string[] = []) => ({
  category,
  places,
  fromPrice: places ? 5 : null,
  nextFree: null,
  popularServices: popular.map((name) => ({ name, fromPrice: 5 })),
});

describe('listedCategories (hide empty categories)', () => {
  it('keeps only the categories with places, in the design order', () => {
    const list = [entry('physiotherapy', 2), entry('barbers', 3), entry('spa-massage', 0), entry('other', 9)];
    expect(listedCategories(list)).toEqual(['barbers', 'physiotherapy']);
  });
  it('is empty when no category has a place', () => {
    expect(listedCategories(HOME_CATEGORIES.map((c) => entry(c, 0)))).toEqual([]);
  });
  it('treats a category missing from the response as having none', () => {
    expect(listedCategories([entry('barbers', 1)])).toEqual(['barbers']);
  });
});

describe('resolveSelected (default = first category with places)', () => {
  const list = [entry('barbers', 0), entry('hair-salons', 0), entry('dental-clinics', 4), entry('physiotherapy', 1)];
  it('defaults to the first listed category, not the first category', () => {
    expect(resolveSelected(list, null)).toBe('dental-clinics');
  });
  it('keeps a wanted category that is listed', () => expect(resolveSelected(list, 'physiotherapy')).toBe('physiotherapy'));
  it('replaces a wanted category that is empty or unknown', () => {
    expect(resolveSelected(list, 'barbers')).toBe('dental-clinics');
    expect(resolveSelected(list, 'other')).toBe('dental-clinics');
  });
  it('without data falls back to a known wanted category, else the first', () => {
    expect(resolveSelected([], 'physiotherapy')).toBe('physiotherapy');
    expect(resolveSelected([], null)).toBe('barbers');
  });
});

describe('headingKey (Popular services needs >= 3 places)', () => {
  it.each([
    [0, 'services'],
    [1, 'services'],
    [2, 'services'],
    [3, 'popular'],
    [10, 'popular'],
  ])('%i places -> %s', (places, key) => expect(headingKey(places)).toBe(key));
});

describe('heroChips (Popular chips from live data)', () => {
  const fallback = ['Haircut', 'Dental check-up', 'Massage', 'Hydrafacial'];
  it('takes the top service of each non-empty category in order, then the next ones', () => {
    const cats = [
      entry('barbers', 3, ['Fade', 'Shave']),
      entry('hair-salons', 0, ['Ghost']),
      entry('dental-clinics', 2, ['Cleaning', 'Whitening']),
      entry('spa-massage', 1, ['Hot stone']),
    ];
    expect(heroChips(cats, fallback)).toEqual(['Fade', 'Cleaning', 'Hot stone', 'Shave']);
  });
  it('de-duplicates case-insensitively', () => {
    const cats = [
      entry('barbers', 3, ['Haircut', 'Fade']),
      entry('hair-salons', 3, ['haircut', 'Blow-dry']),
      entry('dental-clinics', 1, ['Cleaning']),
    ];
    // The salon's top service duplicates the first chip, so it offers its next one in the same round.
    expect(heroChips(cats, fallback)).toEqual(['Haircut', 'Blow-dry', 'Cleaning', 'Fade']);
  });
  it('caps at 4', () => {
    const cats = HOME_CATEGORIES.map((c, i) => entry(c, 2, [`A${i}`, `B${i}`]));
    expect(heroChips(cats, fallback)).toEqual(['A0', 'A1', 'A2', 'A3']);
  });
  it('falls back to the static list when fewer than 4 are available or nothing is loaded', () => {
    expect(heroChips([entry('barbers', 3, ['Fade', 'Shave'])], fallback)).toEqual(fallback);
    expect(heroChips(undefined, fallback)).toEqual(fallback);
    expect(heroChips([], fallback)).toEqual(fallback);
  });
});

describe('chipTime (outlined chip on a hero row)', () => {
  const now = new Date('2026-11-03T07:00:00.000Z'); // Tue 3 Nov 09:00 Beirut
  it('says today, tomorrow or the weekday, with HH:mm in the BUSINESS zone', () => {
    expect(chipTime('2026-11-03T08:30:00.000Z', 'Asia/Beirut', now, 'en')).toEqual({ day: { kind: 'today' }, time: '10:30' });
    expect(chipTime('2026-11-04T08:30:00.000Z', 'Asia/Beirut', now, 'en')).toEqual({ day: { kind: 'tomorrow' }, time: '10:30' });
    expect(chipTime('2026-11-09T07:30:00.000Z', 'Asia/Beirut', now, 'en')).toEqual({
      day: { kind: 'weekday', text: 'Mon' },
      time: '09:30',
    });
  });
  it('uses Latin digits in Arabic', () => {
    const c = chipTime('2026-11-09T07:30:00.000Z', 'Asia/Beirut', now, 'ar');
    expect(c.time).toBe('09:30');
    expect(c.day.kind).toBe('weekday');
  });
});

describe('request builders (identical URL for every visitor, fixed param order)', () => {
  it('next free panel: area first when set, then include, sort, spread, limit', () => {
    expect(nextFreePanelUrl()).toBe('/api/public/directory?include=nextFree&sort=soonest&spread=category&limit=4');
    expect(nextFreePanelUrl('sidon')).toBe(
      '/api/public/directory?area=sidon&include=nextFree&sort=soonest&spread=category&limit=4',
    );
  });
  it('top places: category, include=nextFree,services (comma encoded), limit 3', () => {
    expect(homeDirectoryUrl({ category: 'barbers' })).toBe(
      '/api/public/directory?category=barbers&include=nextFree%2Cservices&limit=3',
    );
    expect(homeDirectoryUrl({ area: 'sidon', category: 'barbers' })).toBe(
      '/api/public/directory?area=sidon&category=barbers&include=nextFree%2Cservices&limit=3',
    );
  });
});

describe('directory response schema', () => {
  it('accepts the sort=soonest answer, which has NO nextCursor key (the server omits it), and fills null', () => {
    const parsed = directorySchema.parse({ businesses: [] });
    expect(parsed.nextCursor).toBeNull();
  });
  it('still reads a cursor on a normal page', () => {
    expect(directorySchema.parse({ businesses: [], nextCursor: 'abc' }).nextCursor).toBe('abc');
    expect(directorySchema.parse({ businesses: [], nextCursor: null }).nextCursor).toBeNull();
  });
});
