import { describe, expect, it } from 'vitest';
import {
  EXPLORE_LIMIT,
  EXPLORE_WHEN_DAYS,
  activeFilterCount,
  cleanServiceParam,
  cleanWhenParam,
  filtersToSearch,
  hasAnyFilter,
  parseFilters,
  requestUrl,
  sameFilters,
  whenDayText,
  whenRange,
} from '@/lib/directory/explore';

const TODAY = '2026-11-07';
const from = (qs: string, today = TODAY) => {
  const q = new URLSearchParams(qs);
  return parseFilters((name) => q.get(name), today);
};

describe('whenRange', () => {
  it('runs from today to today + 28 days in the viewer calendar', () => {
    expect(whenRange('2026-11-07')).toEqual({ min: '2026-11-07', max: '2026-12-05' });
    expect(EXPLORE_WHEN_DAYS).toBe(28);
  });
  it('crosses a year end and a leap day', () => {
    expect(whenRange('2026-12-20').max).toBe('2027-01-17');
    expect(whenRange('2028-02-10').max).toBe('2028-03-09');
  });
});

describe('cleanWhenParam', () => {
  it.each([
    ['2026-11-07', '2026-11-07'],
    ['2026-12-05', '2026-12-05'],
    ['2026-11-06', ''], // yesterday
    ['2026-12-06', ''], // beyond the window
    ['2026-02-31', ''],
    ['tomorrow', ''],
    ['2026-11-7', ''],
    ['', ''],
    [null, ''],
  ])('%s -> %s', (value, expected) => {
    expect(cleanWhenParam(value, TODAY)).toBe(expected);
  });
});

describe('cleanServiceParam', () => {
  it('trims, drops control characters and cuts to the API limit of 60', () => {
    expect(cleanServiceParam('  Hair\u0000cut ')).toBe('Haircut');
    expect(cleanServiceParam('x'.repeat(200))).toHaveLength(60);
    expect(cleanServiceParam(null)).toBe('');
  });
});

describe('parseFilters', () => {
  it('reads every filter', () => {
    expect(
      from('search=Nour&service=Haircut&area=beirut&category=barbers&when=2026-11-08'),
    ).toEqual({
      search: 'Nour',
      service: 'Haircut',
      area: 'beirut',
      category: 'barbers',
      when: '2026-11-08',
    });
  });
  it('drops unknown or unusable values instead of sending them to the API', () => {
    expect(from('area=mars&when=nope&category=' + 'x'.repeat(41))).toEqual({
      search: '',
      service: '',
      area: '',
      category: '',
      when: '',
    });
  });
  it('"other" is not an area to filter by', () => {
    expect(from('area=other').area).toBe('');
  });
  it('keeps a legacy free-text category (it still matches old listings)', () => {
    expect(from('category=Hair%20salon').category).toBe('Hair salon');
  });
  it('clamps an over-long search to 80', () => {
    expect(from('search=' + 'a'.repeat(300)).search).toHaveLength(80);
  });
});

describe('filtersToSearch (the page URL)', () => {
  const all = {
    search: 'Nour',
    service: 'Haircut',
    area: 'beirut',
    category: 'barbers',
    when: '2026-11-08',
  };
  it('uses the fixed order search, service, area, category, when and omits empty values', () => {
    expect(filtersToSearch(all)).toBe(
      'search=Nour&service=Haircut&area=beirut&category=barbers&when=2026-11-08',
    );
    expect(filtersToSearch({ ...all, search: '', service: '', when: '' })).toBe(
      'area=beirut&category=barbers',
    );
    expect(filtersToSearch(from(''))).toBe('');
  });
  it('round trips', () => {
    expect(from(filtersToSearch(all))).toEqual(all);
  });
  it('is the same whatever order the incoming URL had', () => {
    expect(filtersToSearch(from('when=2026-11-08&category=barbers&area=beirut'))).toBe(
      'area=beirut&category=barbers&when=2026-11-08',
    );
  });
});

describe('requestUrl', () => {
  it('has a fixed param order: search, service, area, category, when, include, limit, cursor', () => {
    expect(
      requestUrl(
        {
          search: 'Nour',
          service: 'Haircut',
          area: 'beirut',
          category: 'barbers',
          when: '2026-11-08',
        },
        'abc',
      ),
    ).toBe(
      '/api/public/directory?search=Nour&service=Haircut&area=beirut&category=barbers&when=2026-11-08&include=nextFree%2Cservices&limit=12&cursor=abc',
    );
    expect(EXPLORE_LIMIT).toBe(12);
  });
  it('is identical for identical filters, however the URL was written', () => {
    const a = from('category=barbers&area=beirut&search=%20Nour%20');
    const b = from('search=Nour&area=beirut&category=barbers');
    expect(requestUrl(a)).toBe(requestUrl(b));
    expect(requestUrl(a)).toBe(
      '/api/public/directory?search=Nour&area=beirut&category=barbers&include=nextFree%2Cservices&limit=12',
    );
  });
  it('without filters it is just the include and the limit', () => {
    expect(requestUrl(from(''))).toBe('/api/public/directory?include=nextFree%2Cservices&limit=12');
  });
});

describe('counts and equality', () => {
  it('the Filters badge counts area, when, category and service (the text box stays visible)', () => {
    expect(activeFilterCount(from(''))).toBe(0);
    expect(activeFilterCount(from('search=Nour'))).toBe(0);
    expect(
      activeFilterCount(
        from('search=a&area=beirut&when=2026-11-08&category=barbers&service=Haircut'),
      ),
    ).toBe(4);
  });
  it('hasAnyFilter includes the text', () => {
    expect(hasAnyFilter(from('search=Nour'))).toBe(true);
    expect(hasAnyFilter(from(''))).toBe(false);
  });
  it('sameFilters compares every field', () => {
    expect(sameFilters(from('area=beirut'), from('area=beirut'))).toBe(true);
    expect(sameFilters(from('area=beirut'), from('area=sidon'))).toBe(false);
  });
});

describe('whenDayText', () => {
  it('weekday and date, no zone shift', () => {
    expect(whenDayText('2026-11-08', 'en')).toBe('Sun 8 Nov');
  });
  it('Arabic uses Latin digits', () => {
    expect(whenDayText('2026-11-08', 'ar')).toMatch(/^[^\d]+ 8 [^\d]+$/);
  });
  it('invalid input gives an empty string', () => {
    expect(whenDayText('nope', 'en')).toBe('');
  });
});
