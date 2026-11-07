import { DateTime } from 'luxon';
import { addDaysYmd, isYmd } from '@/lib/pickers/monthGrid';
import { isAreaKey } from '@/lib/business/profile';
import { cleanCategoryParam, cleanSearchParam } from './params';

/** The Explore page asks for 12 places at a time: the most the API allows when it computes free times. */
export const EXPLORE_LIMIT = 12;
/** `when` is offered from today to today + 28 days (the longest booking window an owner usually sets). */
export const EXPLORE_WHEN_DAYS = 28;
export const EXPLORE_SERVICE_MAX = 60;

export type ExploreFilters = {
  search: string;
  service: string;
  area: string;
  category: string;
  when: string;
};

export const NO_FILTERS: ExploreFilters = { search: '', service: '', area: '', category: '', when: '' };

/** Fixed order: the page URL and the API request list the filters in this order, so equal filters give equal URLs. */
const ORDER = ['search', 'service', 'area', 'category', 'when'] as const;

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** Service text from the URL: control characters removed, cut to the API limit of 60. */
export function cleanServiceParam(value: string | null | undefined): string {
  const text = (value ?? '').replace(CONTROL, '').trim();
  if (text.length <= EXPLORE_SERVICE_MAX) return text;
  let cut = text.slice(0, EXPLORE_SERVICE_MAX);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut.trim();
}

/** The days the "When" control offers, in the VIEWER's calendar (`today` is injected as yyyy-MM-dd). */
export function whenRange(today: string): { min: string; max: string } {
  return { min: today, max: addDaysYmd(today, EXPLORE_WHEN_DAYS) };
}

/** A real day inside today..today+28, else '' (the API would answer a past or far day with an empty page). */
export function cleanWhenParam(value: string | null | undefined, today: string): string {
  if (!isYmd(value ?? '')) return '';
  const day = value as string;
  const { min, max } = whenRange(today);
  if (addDaysYmd(day, 0) !== day) return ''; // 2026-02-31 and friends
  return day >= min && day <= max ? day : '';
}

/** Read the filters from the URL; everything the API would refuse is dropped, never sent. */
export function parseFilters(get: (name: string) => string | null, today: string): ExploreFilters {
  const area = get('area') ?? '';
  return {
    search: cleanSearchParam(get('search')),
    service: cleanServiceParam(get('service')),
    area: isAreaKey(area) && area !== 'other' ? area : '',
    category: cleanCategoryParam(get('category')),
    when: cleanWhenParam(get('when'), today),
  };
}

/** The page query string (no leading "?"), empty values left out, fixed order. */
export function filtersToSearch(filters: ExploreFilters): string {
  const q = new URLSearchParams();
  for (const name of ORDER) if (filters[name]) q.set(name, filters[name]);
  return q.toString();
}

/**
 * The API request for a page of results. Same filters -> the same string (fixed order, no per-visitor values), so the
 * CDN answers repeat visitors from one cache entry. Order: search, service, area, category, when, include, limit, cursor.
 */
export function requestUrl(filters: ExploreFilters, cursor?: string): string {
  const q = new URLSearchParams();
  for (const name of ORDER) if (filters[name]) q.set(name, filters[name]);
  q.set('include', 'nextFree,services');
  q.set('limit', String(EXPLORE_LIMIT));
  if (cursor) q.set('cursor', cursor);
  return `/api/public/directory?${q.toString()}`;
}

/** What the "Filters" button counts: the controls inside the sheet (the text box stays visible beside it). */
export const activeFilterCount = (f: ExploreFilters): number =>
  [f.area, f.when, f.category, f.service].filter(Boolean).length;

/** Anything at all is filtered, the text included ("Clear filters" is shown). */
export const hasAnyFilter = (f: ExploreFilters): boolean => ORDER.some((name) => Boolean(f[name]));

export const sameFilters = (a: ExploreFilters, b: ExploreFilters): boolean =>
  ORDER.every((name) => a[name] === b[name]);

/** "Wed 4 Nov" for a chosen day: weekday and date in the locale, Latin digits, no time zone shift (a plain date). */
export function whenDayText(ymd: string, locale: string): string {
  const dt = DateTime.fromISO(ymd, { zone: 'utc' });
  if (!dt.isValid) return '';
  return dt.setLocale(locale === 'ar' ? 'ar-u-nu-latn' : 'en').toFormat('ccc d LLL');
}
