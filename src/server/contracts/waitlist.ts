import { z } from 'zod';
import { BookingResultDto, SlugParams } from './booking';
import { LinkParams } from './reminders';
import { ErrorResponse, errorResponses, registry } from './registry';

const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });
const err = (description: string) => ({ description, content: json(ErrorResponse) });
const id = z.string().cuid2();
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-10.');
const iso = z.string().datetime();

export const OfferParams = LinkParams;
export const WaitlistEntryParams = z.object({ id }).strict();

// ---- join (public) ----------------------------------------------------------------------------------

export const JoinWaitlistBody = registry.register(
  'JoinWaitlistBody',
  z
    .object({
      serviceId: id,
      staffId: id.nullable(),
      fromDate: localDate,
      toDate: localDate,
      client: z
        .object({
          name: z.string().trim().min(1).max(80),
          phone: z.string().trim().min(3).max(32),
          // Required: offers are sent by email.
          email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
        })
        .strict(),
    })
    .strict(),
);

export const WaitlistJoinedDto = registry.register(
  'WaitlistJoined',
  z.object({
    entry: z.object({
      id: z.string(),
      status: z.literal('OPEN'),
      serviceId: z.string(),
      staffId: z.string().nullable(),
      fromDate: localDate,
      toDate: localDate,
    }),
  }),
);

// ---- offer page (token) -----------------------------------------------------------------------------

export const ClaimBody = registry.register('ClaimBody', z.object({}).strict());

export const OfferViewDto = registry.register(
  'OfferView',
  z.object({
    offer: z.object({
      id: z.string(),
      status: z.enum(['OPEN', 'CLAIMED', 'EXPIRED', 'TAKEN']),
      startAt: iso,
      endAt: iso,
      expiresAt: iso,
      service: z.object({
        id: z.string(),
        name: z.string(),
        durationMin: z.number().int(),
        price: z.number(),
      }),
      staff: z.object({ id: z.string(), displayName: z.string() }),
    }),
    business: z.object({
      name: z.string(),
      slug: z.string(),
      timezone: z.string(),
      locale: z.string(),
    }),
    canClaim: z.boolean(),
  }),
);

// ---- staff side -------------------------------------------------------------------------------------

export const WaitlistListQuery = z
  .object({
    status: z.enum(['OPEN', 'all']).default('OPEN'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const WaitlistActivityQuery = z
  .object({ limit: z.coerce.number().int().min(1).max(50).default(10) })
  .strict();

export const WaitlistListDto = registry.register(
  'WaitlistList',
  z.object({
    entries: z.array(
      z.object({
        id: z.string(),
        client: z.object({ name: z.string(), phone: z.string() }),
        service: z.object({ id: z.string(), name: z.string() }),
        staff: z.object({ id: z.string(), displayName: z.string() }).nullable(),
        fromDate: localDate,
        toDate: localDate,
        status: z.enum(['OPEN', 'FULFILLED', 'CANCELLED']),
        createdAt: iso,
      }),
    ),
  }),
);

export const WaitlistActivityDto = registry.register(
  'WaitlistActivity',
  z.object({
    items: z.array(
      z.object({
        type: z.enum(['OFFERED', 'CLAIMED', 'EXPIRED']),
        at: iso,
        offerId: z.string(),
        slot: z.object({
          startAt: iso,
          service: z.object({ id: z.string(), name: z.string() }),
          staff: z.object({ id: z.string(), displayName: z.string() }),
        }),
        offeredTo: z.number().int(),
        claimedBy: z.object({ name: z.string() }).nullable(),
      }),
    ),
  }),
);

registry.registerPath({
  method: 'post',
  path: '/api/public/{slug}/waitlist',
  summary: 'Join the waitlist for a service and a date range (public)',
  description:
    'Email is required (offers are sent by email). An existing client keeps their stored name and email. A duplicate open entry (same client, service, staff, overlapping dates) returns the existing entry with 200. At most 5 open entries per client: 409 WAITLIST_LIMIT. Abuse limiting is launch gate L6.',
  tags: ['waitlist'],
  request: { params: SlugParams, body: { content: json(JoinWaitlistBody) } },
  responses: {
    200: { description: 'Already on the waitlist', content: json(WaitlistJoinedDto) },
    201: { description: 'Joined', content: json(WaitlistJoinedDto) },
    400: errorResponses[400],
    404: errorResponses[404],
    409: err('WAITLIST_LIMIT: too many open entries'),
  },
});

const offerErrors = {
  400: errorResponses[400],
  404: errorResponses[404],
  410: err('OFFER_EXPIRED'),
};

registry.registerPath({
  method: 'get',
  path: '/api/offers/{token}',
  summary: 'Read a waitlist offer through its signed link (no side effects)',
  tags: ['waitlist'],
  request: { params: OfferParams },
  responses: { 200: { description: 'Offer', content: json(OfferViewDto) }, ...offerErrors },
});

registry.registerPath({
  method: 'post',
  path: '/api/offers/{token}/claim',
  summary: 'Claim a waitlist offer (books through the normal booking path)',
  description:
    'First claim wins: the loser gets 409 SLOT_TAKEN. A repeat of a successful claim returns the same booking with 200.',
  tags: ['waitlist'],
  request: { params: OfferParams, body: { content: json(ClaimBody) } },
  responses: {
    200: { description: 'Already claimed: the first booking', content: json(BookingResultDto) },
    201: { description: 'Booked', content: json(BookingResultDto) },
    409: err('SLOT_TAKEN: someone else took this spot'),
    ...offerErrors,
  },
});

const session = [{ session: [] }];

registry.registerPath({
  method: 'get',
  path: '/api/waitlist',
  summary: 'Waitlist entries (OWNER or STAFF)',
  tags: ['waitlist'],
  security: session,
  request: { query: WaitlistListQuery },
  responses: {
    200: { description: 'Entries, newest first', content: json(WaitlistListDto) },
    400: errorResponses[400],
    401: errorResponses[401],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/waitlist/activity',
  summary: 'Recent refill activity, one item per freed slot (OWNER or STAFF)',
  tags: ['waitlist'],
  security: session,
  request: { query: WaitlistActivityQuery },
  responses: {
    200: { description: 'Activity, newest first', content: json(WaitlistActivityDto) },
    400: errorResponses[400],
    401: errorResponses[401],
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/waitlist/{id}',
  summary: 'Cancel a waitlist entry (OWNER or STAFF)',
  tags: ['waitlist'],
  security: session,
  request: { params: WaitlistEntryParams },
  responses: {
    204: { description: 'Cancelled (idempotent)' },
    400: errorResponses[400],
    401: errorResponses[401],
    404: errorResponses[404],
    409: err('CONFLICT: the entry was already fulfilled'),
  },
});
