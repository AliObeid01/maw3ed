import { z } from 'zod';
import { request } from './auth';

export const directorySchema =z.object({
  businesses: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      category: z.string().nullable(),
      area: z.string().nullable().default(null),
      address: z.string().nullable(),
      /** Versioned public logo url, or null (the initials tile is shown). */
      logoUrl: z.string().nullable().default(null),
      serviceCount: z.number(),
      fromPrice: z.number().nullable(),
      // Only with `include=nextFree` (the home page).
      timezone: z.string().optional(),
      nextFree: z
        .object({
          startAt: z.string(),
          service: z.object({ id: z.string(), name: z.string(), durationMin: z.number() }),
        })
        .nullable()
        .optional(),
      freeTimes: z.array(z.string()).optional(),
      /** Open now by the posted hours (HH:mm in the business zone); absent in older cached responses. */
      openStatus: z
        .object({ open: z.boolean(), until: z.string().optional(), opensAt: z.string().optional() })
        .optional(),
      // Only with `include=services` (the Explore page): up to 4 active services, cheapest first.
      services: z
        .array(z.object({ name: z.string(), durationMin: z.number(), price: z.number() }))
        .optional(),
    }),
  ),
  /** Absent with `sort=soonest` (the hero panel has no paging): read as null. */
  nextCursor: z.string().nullable().default(null),
});
export type DirectoryPage = z.infer<typeof directorySchema>;
export type DirectoryBusiness = DirectoryPage['businesses'][number];

export const getDirectory = (
  params: { search?: string; category?: string; area?: string; cursor?: string; limit?: number },
  signal?: AbortSignal,
) => {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.category) q.set('category', params.category);
  if (params.area) q.set('area', params.area);
  if (params.cursor) q.set('cursor', params.cursor);
  if (params.limit) q.set('limit', String(params.limit));
  const qs = q.toString();
  return request(`/api/public/directory${qs ? `?${qs}` : ''}`, directorySchema, { signal });
};

/** One Explore page of results. `url` comes from `requestUrl` (lib/directory/explore.ts): same filters, same URL. */
export const getExplorePage = (url: string, signal?: AbortSignal) =>
  request(url, directorySchema, { signal });
