import { z } from 'zod';
import { AREA_KEYS } from '../../lib/business/profile';
import { errorResponses, registry } from './registry';

/** `search` and `category` are optional; an empty string means "not set". */
/** Postgres text cannot hold NUL; reject it at the edge instead of letting the query fail. */
const noNul = (v: string) => !v.includes(String.fromCharCode(0));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(noNul, 'Remove the NUL character.')
    .optional()
    .transform((v) => (v ? v : undefined));

export const DirectoryQuery = z
  .object({
    search: optionalText(80),
    category: optionalText(40).openapi({
      description:
        'A category key (barbers, hair-salons, ...) or, for legacy listings, the free text they were saved with. Case-insensitive equality.',
    }),
    area: z
      .enum(AREA_KEYS)
      .optional()
      .or(z.literal('').transform(() => undefined))
      .openapi({ description: 'Area key. Empty means unset. Businesses without an area match only when this is unset.' }),
    limit: z.coerce.number().int().min(1).max(50).default(24),
    cursor: z
      .string()
      .max(300)
      .refine((v) => {
        if (!noNul(v)) return false;
        const decoded = Buffer.from(v, 'base64url').toString('utf8');
        if (!noNul(decoded)) return false;
        try {
          // The cursor is JSON, so a NUL can hide as an escape: check the parsed strings too.
          const parsed: unknown = JSON.parse(decoded);
          return !Array.isArray(parsed) || parsed.every((p) => typeof p !== 'string' || noNul(p));
        } catch {
          return true; // not JSON: the service answers 400 "Invalid cursor"
        }
      }, 'Invalid cursor.')
      .optional(),
  })
  .strict();
export type DirectoryQueryT = z.infer<typeof DirectoryQuery>;

export const DirectoryDto = registry.register(
  'Directory',
  z.object({
    businesses: z.array(
      z.object({
        slug: z.string(),
        name: z.string(),
        category: z.string().nullable(),
        area: z.string().nullable(),
        address: z.string().nullable(),
        serviceCount: z.number().int(),
        fromPrice: z.number().nullable().openapi({ description: 'Cheapest active service price.' }),
      }),
    ),
    nextCursor: z.string().nullable().openapi({ description: 'Opaque. Pass back as `cursor`.' }),
  }),
);

registry.registerPath({
  method: 'get',
  path: '/api/public/directory',
  summary: 'Public directory of opted-in businesses that are ready to take bookings',
  description:
    'Only businesses with `listed = true` that still have an active service and a bookable staff member with working hours. Sorted by name then id. No owner, staff or client data. Cacheable for 60 s.',
  tags: ['public'],
  request: { query: DirectoryQuery },
  responses: {
    200: {
      description: 'A page of businesses',
      content: { 'application/json': { schema: DirectoryDto } },
    },
    400: errorResponses[400],
    429: { description: 'RATE_LIMITED (Retry-After header)' },
  },
});
