import { z } from 'zod';
import { errorResponses, registry } from './registry';

/** `search` and `category` are optional; an empty string means "not set". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const DirectoryQuery = z
  .object({
    search: optionalText(80),
    category: optionalText(40),
    limit: z.coerce.number().int().min(1).max(50).default(24),
    cursor: z.string().max(300).optional(),
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
