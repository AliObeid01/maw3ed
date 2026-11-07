import { DateTime } from 'luxon';
import { z } from 'zod';
import { AREA_KEYS, CATEGORY_KEYS } from '../../lib/business/profile';
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

export const INCLUDE_VALUES = ['nextFree', 'services'] as const;

/** Which optional blocks `include` asks for. */
export function includeFlags(include: string | undefined): { nextFree: boolean; services: boolean } {
  const parts = (include ?? '').split(',');
  return { nextFree: parts.includes('nextFree'), services: parts.includes('services') };
}

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
      .openapi({
        description:
          'Area key. Empty means unset. Businesses without an area match only when this is unset.',
      }),
    service: optionalText(60).openapi({
      description:
        'Text matched (case-insensitive, contains) against the names of ACTIVE services. Combines with `search`.',
    }),
    when: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-10.')
      .refine(
        (v) => v >= '2000-01-01' && v <= '2100-12-31',
        'Use a date between 2000-01-01 and 2100-12-31.',
      )
      .refine(
        (v) => DateTime.fromISO(v, { zone: 'utc' }).isValid,
        'Use a real date like 2026-11-10.',
      )
      .optional()
      .or(z.literal('').transform(() => undefined))
      .openapi({
        description:
          'Local day (yyyy-MM-dd, in each business timezone). Keeps only businesses with at least one free slot that day, for their shortest bookable service. Computed with the slot engine for a bounded scan, so a page can hold fewer than `limit` items and still carry a `nextCursor`: keep paging until it is null. With it, `nextFree` / `freeTimes` describe that day.',
      }),
    include: z
      .string()
      .max(40)
      .refine(
        (v) => v === '' || v.split(',').every((p) => (INCLUDE_VALUES as readonly string[]).includes(p)),
        'Use nextFree, services or nextFree,services.',
      )
      .optional()
      .transform((v) => (v ? v : undefined))
      .openapi({
        description:
          'Comma list of `nextFree` and/or `services`. `nextFree` adds `timezone`, `nextFree` and `freeTimes` to every item (computed live, so costlier). `services` adds `services`: up to 4 active services (cheapest first, then name) with name, durationMin and price. Both cap the page at 12. Off by default.',
      }),
    limit: z.coerce.number().int().min(1).max(50).optional().openapi({
      description: 'Default 24; default 12 and at most 12 when `include` or `when` is set.',
    }),
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

const NextFreeService = z.object({
  id: z.string(),
  name: z.string(),
  durationMin: z.number().int(),
});

/** The earliest bookable start of the business's shortest bookable service, as a UTC instant. */
const NextFree = z.object({
  startAt: z.string().datetime(),
  service: NextFreeService,
});

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
        timezone: z.string().optional().openapi({
          description:
            'Only with `include=nextFree` / `when`: IANA zone to format the instants in.',
        }),
        nextFree: NextFree.nullable().optional().openapi({
          description:
            'Only with `include=nextFree` / `when`. Earliest bookable start of the shortest bookable active service over the next 7 local days (or on the `when` day); null when there is none.',
        }),
        services: z
          .array(z.object({ name: z.string(), durationMin: z.number().int(), price: z.number() }))
          .max(4)
          .optional()
          .openapi({
            description:
              'Only with `include=services`. Up to 4 active services, cheapest first, then by name.',
          }),
        freeTimes: z.array(z.string().datetime()).max(4).optional().openapi({
          description:
            'Only with `include=nextFree` / `when`. Up to 4 start instants on the first local day that has any.',
        }),
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
    'Only businesses with `listed = true` that still have an active service and a bookable staff member with working hours. Sorted by name then id. No owner, staff or client data. Cacheable for 60 s (`public, s-maxage=60, stale-while-revalidate=300`). `include` (`nextFree`, `services`) and `when` bound the page (at most 12 businesses; slots are computed for a scan of at most 36 candidates) and have their own per-IP rate limit.',
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

// ---- categories ---------------------------------------------------------------------------------------

export const CategoriesQuery = z
  .object({
    area: z
      .enum(AREA_KEYS)
      .optional()
      .or(z.literal('').transform(() => undefined))
      .openapi({ description: 'Area key. Empty means every area.' }),
  })
  .strict();
export type CategoriesQueryT = z.infer<typeof CategoriesQuery>;

export const CategoriesDto = registry.register(
  'Categories',
  z.object({
    categories: z
      .array(
        z.object({
          category: z.enum(CATEGORY_KEYS),
          places: z
            .number()
            .int()
            .openapi({ description: 'Listed, ready businesses in the category.' }),
          fromPrice: z
            .number()
            .nullable()
            .openapi({ description: 'Cheapest active service price in the category.' }),
          nextFree: NextFree.extend({
            business: z.object({ slug: z.string(), name: z.string(), timezone: z.string() }),
          })
            .nullable()
            .openapi({
              description:
                'Earliest next-free instant among the first 6 businesses of the category (by name). Null when none of them has one.',
            }),
          popularServices: z
            .array(z.object({ name: z.string(), fromPrice: z.number() }))
            .max(5)
            .openapi({ description: 'Top 5 service names by number of businesses offering them.' }),
        }),
      )
      .openapi({
        description: 'Every fixed category key, in order, including those with zero places.',
      }),
  }),
);

registry.registerPath({
  method: 'get',
  path: '/api/public/categories',
  summary:
    'Per-category aggregates for the home page: places, prices from, next free, popular services',
  description:
    'Only listed, ready businesses. Counts and prices are SQL aggregates; `nextFree` is computed for the first 6 businesses of each category only. Cacheable for 60 s. Own per-IP rate limit.',
  tags: ['public'],
  request: { query: CategoriesQuery },
  responses: {
    200: {
      description: 'One entry per category key',
      content: { 'application/json': { schema: CategoriesDto } },
    },
    400: errorResponses[400],
    429: { description: 'RATE_LIMITED (Retry-After header)' },
  },
});
