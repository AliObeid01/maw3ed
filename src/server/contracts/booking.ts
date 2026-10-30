import { z } from 'zod';
import { ErrorResponse, errorResponses, registry } from './registry';

const id = z.string().cuid2();
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-10.');
const isoInstant = z
  .string()
  .datetime({ message: 'Use an ISO 8601 UTC time like 2026-11-10T09:00:00Z.' });
const money = z.number();

export const SlugParams = z
  .object({ slug: z.string().trim().toLowerCase().min(1).max(80) })
  .strict();
export const AppointmentParams = z.object({ id }).strict();

// ---- public read ------------------------------------------------------------------------------------

export const PublicBusinessDto = registry.register(
  'PublicBusiness',
  z.object({
    business: z.object({
      name: z.string(),
      slug: z.string(),
      timezone: z.string(),
      locale: z.string(),
      /** How many days ahead clients may book (the slots endpoint rejects `to` beyond it). */
      bookingWindowDays: z.number().int(),
      /** Clients can cancel for free until this many minutes before the start. */
      cancelCutoffMin: z.number().int(),
      category: z.string().optional(),
      address: z.string().optional(),
    }),
    services: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        durationMin: z.number().int(),
        bufferMin: z.number().int(),
        price: money,
      }),
    ),
    staff: z.array(
      z.object({ id: z.string(), displayName: z.string(), serviceIds: z.array(z.string()) }),
    ),
  }),
);

export const SlotsQuery = z
  .object({ serviceId: id, staffId: id.optional(), from: localDate, to: localDate })
  .strict();

const SlotDto = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  staffId: z
    .string()
    .optional()
    .openapi({ description: 'Present only when a specific staff member was requested.' }),
});
export const SlotsDto = registry.register('Slots', z.object({ slots: z.array(SlotDto) }));

// ---- booking ----------------------------------------------------------------------------------------

const ClientInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    phone: z.string().trim().min(3).max(32),
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)).optional(),
  })
  .strict();

export const BookingBody = registry.register(
  'BookingBody',
  z
    .object({
      serviceId: id,
      staffId: z.union([z.literal('anyone'), id]),
      startAt: isoInstant,
      client: ClientInput,
    })
    .strict(),
);

const idempotencyKey = z
  .string()
  .min(8)
  .max(100)
  .regex(/^[A-Za-z0-9_.:-]+$/, 'Use letters, digits and - _ . : only.');

/** Headers are not `.strict()`: every request carries many unrelated headers. */
export const RequiredIdempotencyHeaders = z.object({ 'idempotency-key': idempotencyKey });
export const OptionalIdempotencyHeaders = z.object({
  'idempotency-key': idempotencyKey.optional(),
});

const BookedAppointment = z.object({
  id: z.string(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  status: z.string(),
  service: z.object({
    id: z.string(),
    name: z.string(),
    durationMin: z.number().int(),
    price: money,
  }),
  staff: z.object({ id: z.string(), displayName: z.string() }),
});

export const BookingResultDto = registry.register(
  'BookingResult',
  z.object({
    appointment: BookedAppointment,
    links: z.object({
      manage: z.string().openapi({ description: 'Signed link, expires at the appointment start.' }),
    }),
    status: z.literal('PENDING_PAYMENT').optional().openapi({
      description:
        'Only when a deposit is needed first: the slot is held (appointment.status PENDING_PAYMENT) until holdExpiresAt. No reminders or confirmation email until it is paid.',
    }),
    payUrl: z.string().optional().openapi({ description: 'Pay page, with the `pay` token.' }),
    payToken: z.string().optional(),
    holdExpiresAt: z.string().datetime().optional(),
  }),
);

// ---- dashboard --------------------------------------------------------------------------------------

export const AppointmentsQuery = z
  .object({ from: localDate, to: localDate, staffId: id.optional() })
  .strict();

const AppointmentItem = BookedAppointment.extend({
  source: z.enum(['PUBLIC', 'FRONT_DESK', 'WAITLIST']),
  client: z.object({
    id: z.string(),
    name: z.string(),
    phone: z.string(),
    noShows: z.number().int(),
    repeatNoShow: z.boolean(),
    lateCancels: z.number().int(),
  }),
});
export const AppointmentItemDto = registry.register('Appointment', AppointmentItem);
export const AppointmentListDto = registry.register(
  'AppointmentList',
  z.object({ appointments: z.array(AppointmentItem) }),
);
export const AppointmentOneDto = registry.register(
  'AppointmentDetail',
  z.object({ appointment: AppointmentItem }),
);

const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });
const err = (description: string) => ({ description, content: json(ErrorResponse) });
const slotTaken = err('SLOT_TAKEN with `error.data.slots` (fresh slots for that day), or CONFLICT');
const keyReused = err('IDEMPOTENCY_KEY_REUSED: the key was used for a different booking');

registry.registerPath({
  method: 'get',
  path: '/api/public/{slug}',
  summary: 'Public booking page data: business, active services, bookable staff',
  tags: ['public'],
  request: { params: SlugParams },
  responses: {
    200: { description: 'Business catalogue', content: json(PublicBusinessDto) },
    400: errorResponses[400],
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/public/{slug}/slots',
  summary: 'Bookable slots for a service over at most 31 local days',
  description:
    'Without `staffId` ("anyone") distinct start times are returned without any staff id. Never cached: slots change on booking.',
  tags: ['public'],
  request: { params: SlugParams, query: SlotsQuery },
  responses: {
    200: { description: 'Slots', content: json(SlotsDto) },
    400: errorResponses[400],
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/public/{slug}/bookings',
  summary: 'Book a slot (public)',
  description:
    'Requires an Idempotency-Key header. A repeat with the same key returns the first booking with 200. Past slots, slots inside the minimum notice and taken slots answer 409 SLOT_TAKEN with fresh slots.',
  tags: ['public'],
  request: {
    params: SlugParams,
    headers: RequiredIdempotencyHeaders,
    body: { content: json(BookingBody) },
  },
  responses: {
    200: { description: 'Idempotent replay of the first booking', content: json(BookingResultDto) },
    201: { description: 'Booked', content: json(BookingResultDto) },
    400: errorResponses[400],
    404: errorResponses[404],
    409: slotTaken,
    422: keyReused,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/appointments',
  summary: 'Appointments in a local date range (at most 62 days)',
  tags: ['appointments'],
  security: [{ session: [] }],
  request: { query: AppointmentsQuery },
  responses: {
    200: { description: 'Appointments', content: json(AppointmentListDto) },
    400: errorResponses[400],
    401: errorResponses[401],
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/appointments',
  summary: 'Front-desk booking (OWNER or STAFF); same engine as the public page',
  tags: ['appointments'],
  security: [{ session: [] }],
  request: { headers: OptionalIdempotencyHeaders, body: { content: json(BookingBody) } },
  responses: {
    200: { description: 'Idempotent replay of the first booking', content: json(BookingResultDto) },
    201: { description: 'Booked', content: json(BookingResultDto) },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: slotTaken,
    422: keyReused,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/appointments/{id}',
  summary: 'One appointment',
  tags: ['appointments'],
  security: [{ session: [] }],
  request: { params: AppointmentParams },
  responses: {
    200: { description: 'Appointment', content: json(AppointmentOneDto) },
    400: errorResponses[400],
    401: errorResponses[401],
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/appointments/{id}/cancel',
  summary: 'Cancel an appointment (frees the slot, skips pending reminders)',
  tags: ['appointments'],
  security: [{ session: [] }],
  request: { params: AppointmentParams },
  responses: {
    200: { description: 'Cancelled (idempotent)', content: json(AppointmentOneDto) },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: err('CONFLICT: the appointment already has an outcome'),
  },
});
