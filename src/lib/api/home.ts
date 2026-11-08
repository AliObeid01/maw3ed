import { z } from 'zod';
import { request } from './auth';
import { directorySchema } from './directory';

const categoriesSchema = z.object({
  categories: z.array(
    z.object({
      category: z.string(),
      places: z.number(),
      fromPrice: z.number().nullable(),
      nextFree: z
        .object({
          startAt: z.string(),
          service: z.object({ id: z.string(), name: z.string(), durationMin: z.number() }),
          business: z.object({ slug: z.string(), name: z.string(), timezone: z.string() }),
        })
        .nullable(),
      popularServices: z.array(z.object({ name: z.string(), fromPrice: z.number() })),
    }),
  ),
});
export type HomeCategories = z.infer<typeof categoriesSchema>;
export type HomeCategory = HomeCategories['categories'][number];

/** Cards on the home page: three per request. */
export const HOME_LIMIT = 3;

/**
 * The URLs are built so that every visitor sends the SAME request: no per-user params, a fixed (alphabetical)
 * parameter order, nothing random. The CDN then serves them from one cache entry (`s-maxage=60`) and shared
 * networks do not use up the per-IP `directoryLive` budget.
 */
export const categoriesUrl = (area?: string): string =>
  area ? `/api/public/categories?area=${encodeURIComponent(area)}` : '/api/public/categories';

export function homeDirectoryUrl({ area, category }: { area?: string; category?: string } = {}): string {
  const q = new URLSearchParams();
  if (area) q.set('area', area);
  if (category) q.set('category', category);
  q.set('include', 'nextFree,services'); // encoded as nextFree%2Cservices
  q.set('limit', String(HOME_LIMIT));
  return `/api/public/directory?${q.toString()}`;
}

/** Rows in the hero's "Next free" panel (one business per row, spread across categories). */
export const PANEL_ROWS = 4;

/**
 * The hero panel: the soonest business of each category. Same URL for every visitor (fixed param order, no per-user
 * values), so the CDN serves one cache entry. `sort=soonest` needs `include=nextFree` and has no cursor.
 */
export const nextFreePanelUrl = (area?: string): string => {
  const q = new URLSearchParams();
  if (area) q.set('area', area);
  q.set('include', 'nextFree');
  q.set('sort', 'soonest');
  q.set('spread', 'category');
  q.set('limit', String(PANEL_ROWS));
  return `/api/public/directory?${q.toString()}`;
};

export const getHomeCategories = (signal?: AbortSignal) =>
  request(categoriesUrl(), categoriesSchema, { signal });

type Directory = z.infer<typeof directorySchema>;
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; promise: Promise<Directory> }>();

/**
 * One request per distinct selection, kept in memory for as long as the CDN keeps it (60 s): flipping between
 * categories never asks twice. A failed request is not kept. The request is never aborted by the caller's signal
 * so a shared in-flight promise cannot be cancelled for the next reader.
 */
export function getHomeDirectory(params: { area?: string; category?: string } = {}): Promise<Directory> {
  const key = homeDirectoryUrl(params);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = request(key, directorySchema);
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

const panelCache = new Map<string, { at: number; data: Directory }>();

/**
 * The hero panel for an area (or all areas): kept in memory for 60 s per area, like the CDN does. Unlike the shared
 * promises above this request IS cancellable (the area select aborts the previous one); only a finished answer is
 * cached, so an aborted or failed request leaves nothing behind.
 */
export async function getNextFreePanel(area = '', signal?: AbortSignal): Promise<Directory> {
  const key = nextFreePanelUrl(area);
  const hit = panelCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const data = await request(key, directorySchema, { signal });
  panelCache.set(key, { at: Date.now(), data });
  return data;
}

const catCache = new Map<string, { at: number; promise: Promise<HomeCategories> }>();

/**
 * The per-category aggregates (popular services among them) for an area or for all areas, kept 60 s like the CDN
 * does, so the Explore page's service chips never ask twice for the same area.
 */
export function getCategoriesCached(area = ''): Promise<HomeCategories> {
  const key = categoriesUrl(area);
  const hit = catCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = request(key, categoriesSchema);
  catCache.set(key, { at: Date.now(), promise });
  promise.catch(() => {
    if (catCache.get(key)?.promise === promise) catCache.delete(key);
  });
  return promise;
}

/** Test hook: forget what was cached. */
export const clearHomeCache = () => {
  cache.clear();
  panelCache.clear();
  catCache.clear();
};
