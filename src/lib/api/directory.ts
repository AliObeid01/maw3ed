import { z } from 'zod';
import { request } from './auth';

const directorySchema = z.object({
  businesses: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      category: z.string().nullable(),
      area: z.string().nullable().default(null),
      address: z.string().nullable(),
      serviceCount: z.number(),
      fromPrice: z.number().nullable(),
    }),
  ),
  nextCursor: z.string().nullable(),
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
