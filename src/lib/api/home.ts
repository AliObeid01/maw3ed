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
export const categoriesUrl = (): string => '/api/public/categories';

export function homeDirectoryUrl({ area, category }: { area?: string; category?: string } = {}): string {
  const q = new URLSearchParams();
  if (area) q.set('area', area);
  if (category) q.set('category', category);
  q.set('include', 'nextFree');
  q.set('limit', String(HOME_LIMIT));
  return `/api/public/directory?${q.toString()}`;
}

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

/** Test hook: forget what was cached. */
export const clearHomeCache = () => cache.clear();
