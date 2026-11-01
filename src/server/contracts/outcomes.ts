import { z } from 'zod';
import { ErrorResponse, errorResponses, registry } from './registry';

const id = z.string().cuid2();
const iso = z.string().datetime();
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-10.');
const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });
const err = (description: string) => ({ description, content: json(ErrorResponse) });
const session = [{ session: [] }];

// ---- outcomes -----------------------------------------------------------------------------------------

export const OutcomeParams = z.object({ id }).strict();
export const OutcomeBody = registry.register(
  'OutcomeBody',
  z.object({ outcome: z.enum(['ATTENDED', 'NO_SHOW', 'LATE_CANCEL']) }).strict(),
);
export const OutcomeResultDto = registry.register(
  'OutcomeResult',
  z.object({
    appointment: z.object({
      id: z.string(),
      status: z.string(),
      startAt: iso,
      endAt: iso,
      client: z.object({
        id: z.string(),
        name: z.string(),
        phone: z.string(),
        attended: z.number().int(),
        noShows: z.number().int(),
        lateCancels: z.number().int(),
      }),
    }),
  }),
);

export const QueueQuery = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(100) })
  .strict();
export const QueueDto = registry.register(
  'OutcomeQueue',
  z.object({
    count: z
      .number()
      .int()
      .openapi({ description: 'All appointments waiting for an outcome (not capped by limit).' }),
    items: z.array(
      z.object({
        id: z.string(),
        startAt: iso,
        endAt: iso,
        service: z.object({ id: z.string(), name: z.string() }),
        staff: z.object({ id: z.string(), displayName: z.string() }),
        client: z.object({
          id: z.string(),
          name: z.string(),
          phone: z.string(),
          noShows: z.number().int(),
        }),
      }),
    ),
  }),
);

registry.registerPath({
  method: 'patch',
  path: '/api/appointments/{id}/outcome',
  summary: 'Record attended / no-show / late cancel (and correct it later)',
  description:
    'Only for appointments that have started (409 NOT_STARTED); ATTENDED additionally needs the appointment to have ended (409 NOT_ENDED), because leaving BOOKED/CONFIRMED re-opens the slot in the no-overlap constraint; NO_SHOW and LATE_CANCEL are allowed once it started. Re-marking between outcomes moves one count between the client counters in the same transaction; the same outcome again is a no-op 200. CANCELLED appointments, and a LATE_CANCEL recorded by the cancel flow, cannot become attended or no-show (409 CONFLICT).',
  tags: ['outcomes'],
  security: session,
  request: { params: OutcomeParams, body: { content: json(OutcomeBody) } },
  responses: {
    200: { description: 'Updated', content: json(OutcomeResultDto) },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: err('NOT_STARTED, NOT_ENDED or CONFLICT'),
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/outcomes/queue',
  summary: 'Past appointments still waiting for an outcome, newest first',
  tags: ['outcomes'],
  security: session,
  request: { query: QueueQuery },
  responses: {
    200: { description: 'Queue', content: json(QueueDto) },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
  },
});

// ---- clients ------------------------------------------------------------------------------------------

export const ClientParams = z.object({ id }).strict();
export const ClientsQuery = z
  .object({
    search: z.string().trim().max(80).optional(),
    sort: z.enum(['name', 'noShows', 'recent']).default('name'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,40}$/, 'Invalid cursor.')
      .optional(),
  })
  .strict();

const ClientBase = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  attended: z.number().int(),
  noShows: z.number().int(),
  lateCancels: z.number().int(),
  lastVisitAt: iso.nullable(),
  repeatNoShow: z.boolean(),
});
export const ClientListDto = registry.register(
  'ClientList',
  z.object({ clients: z.array(ClientBase), nextCursor: z.string().nullable() }),
);
export const ClientDetailDto = registry.register(
  'ClientDetail',
  z.object({
    client: ClientBase.extend({ createdAt: iso }),
    history: z.array(
      z.object({
        id: z.string(),
        startAt: iso,
        status: z.string(),
        service: z.object({ id: z.string(), name: z.string() }),
        staff: z.object({ id: z.string(), displayName: z.string() }),
      }),
    ),
  }),
);

registry.registerPath({
  method: 'get',
  path: '/api/clients',
  summary: 'Clients with attendance counters (search by name or phone digits)',
  tags: ['clients'],
  security: session,
  request: { query: ClientsQuery },
  responses: {
    200: { description: 'Page of clients', content: json(ClientListDto) },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/clients/{id}',
  summary: 'One client with their latest 50 appointments',
  tags: ['clients'],
  security: session,
  request: { params: ClientParams },
  responses: {
    200: { description: 'Client', content: json(ClientDetailDto) },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});
registry.registerPath({
  method: 'delete',
  path: '/api/clients/{id}',
  summary:
    'Delete a client on request (owner): anonymise, cancel future bookings, close waitlist entries',
  tags: ['clients'],
  security: session,
  request: { params: ClientParams },
  responses: {
    204: { description: 'Anonymised' },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

// ---- pilot --------------------------------------------------------------------------------------------

export const BaselineBody = registry.register(
  'PilotBaselineBody',
  z
    .object({
      fromDate: localDate,
      toDate: localDate,
      appointments: z.number().int().min(0).max(10_000),
      noShows: z.number().int().min(0).max(10_000),
      lateCancels: z.number().int().min(0).max(10_000),
    })
    .strict(),
);
const BaselineShape = z.object({
  fromDate: localDate,
  toDate: localDate,
  appointments: z.number().int().openapi({
    description:
      'Appointments held or missed (attended + no-shows). Excludes cancellations and late cancels.',
  }),
  noShows: z.number().int(),
  lateCancels: z.number().int(),
});
export const BaselineDto = registry.register(
  'PilotBaseline',
  z.object({ baseline: BaselineShape.nullable() }),
);

export const ReportQuery = z
  .object({ weeks: z.coerce.number().int().min(1).max(26).default(4) })
  .strict();
const nullableNumber = z.number().nullable();
export const ReportDto = registry.register(
  'PilotReport',
  z.object({
    rateDefinition: z
      .string()
      .openapi({ description: 'Pilot rate definition to show next to the numbers.' }),
    baselineDefinition: z
      .string()
      .openapi({ description: 'What the baseline appointments field means.' }),
    baseline: BaselineShape.nullable(),
    pilot: z.object({
      fromDate: localDate,
      toDate: localDate,
      daysCovered: z.number().int(),
      appointments: z.number().int(),
      attended: z.number().int(),
      noShows: z.number().int(),
      lateCancels: z.number().int(),
      noShowRate: nullableNumber.openapi({
        description:
          'Percent, 1 decimal: noShows / (attended + noShows). Null without marked outcomes.',
      }),
      baselineRate: nullableNumber.openapi({
        description: 'Percent: baseline noShows / baseline appointments.',
      }),
      changePoints: nullableNumber.openapi({
        description: 'pilot rate minus baseline rate, percentage points.',
      }),
      changeRelativePct: nullableNumber.openapi({
        description: 'Relative change; null when the baseline rate is 0.',
      }),
    }),
    weekly: z.array(
      z.object({
        weekStart: localDate,
        appointments: z.number().int(),
        attended: z.number().int(),
        noShows: z.number().int(),
        lateCancels: z.number().int(),
        noShowRate: nullableNumber,
      }),
    ),
    signals: z.object({
      confirmRate: nullableNumber.openapi({
        description:
          'Percent. Population: appointments that already started, not CANCELLED, LATE_CANCEL or PENDING_PAYMENT, that had at least one H24 or H2 reminder SENT (email or WhatsApp). confirmRate = the share of them with confirmedAt set. The booking email carries the confirm link too, so a confirmation may pre-date the reminder.',
      }),
      cancellationsViaLink: z.number().int(),
      waitlistSlotsOffered: z.number().int().openapi({
        description:
          'Freed slots offered to the waitlist: distinct freedFromAppointmentId of offers created in the pilot window.',
      }),
      waitlistRefills: z.number().int().openapi({
        description:
          'Of those freed slots, the ones whose offer was CLAIMED (rebooked from the waitlist).',
      }),
      waitlistRefillRate: nullableNumber.openapi({
        description:
          'Percent: waitlistRefills / waitlistSlotsOffered. Null when nothing was offered.',
      }),
    }),
  }),
);

export const ExportQuery = z.object({ from: localDate, to: localDate }).strict();

registry.registerPath({
  method: 'get',
  path: '/api/pilot/baseline',
  summary: 'The owner-entered pre-pilot baseline (owner)',
  tags: ['pilot'],
  security: session,
  responses: {
    200: { description: 'Baseline or null', content: json(BaselineDto) },
    401: errorResponses[401],
    403: errorResponses[403],
  },
});
registry.registerPath({
  method: 'put',
  path: '/api/pilot/baseline',
  summary: 'Set or replace the baseline (owner)',
  description:
    'appointments = held or missed (attended + no-shows), EXCLUDING cancellations and late cancels, which go in lateCancels; baseline rate = noShows / appointments, comparable with the pilot rate noShows / (attended + noShows). toDate >= fromDate, at most 31 days, not in the future (business timezone); noShows <= appointments; appointments + lateCancels <= 10000.',
  tags: ['pilot'],
  security: session,
  request: { body: { content: json(BaselineBody) } },
  responses: {
    200: { description: 'Saved', content: json(BaselineDto) },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/pilot/report',
  summary: 'Pilot results: no-show rate vs baseline, weekly series and signals (owner)',
  tags: ['pilot'],
  security: session,
  request: { query: ReportQuery },
  responses: {
    200: { description: 'Report', content: json(ReportDto) },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/pilot/export.csv',
  summary: 'Appointments CSV for a local date range of at most 366 days (owner)',
  tags: ['pilot'],
  security: session,
  request: { query: ExportQuery },
  responses: {
    200: {
      description: 'text/csv; charset=utf-8 attachment with a UTF-8 BOM',
      content: { 'text/csv': { schema: z.string() } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
  },
});

// ---- dashboard ----------------------------------------------------------------------------------------

export const TodayQuery = z.object({ date: localDate.optional() }).strict();
export const SummaryDto = registry.register(
  'DashboardSummary',
  z.object({ whatsappDue: z.number().int(), outcomesToMark: z.number().int() }),
);
export const TodayDto = registry.register(
  'DashboardToday',
  z.object({
    date: localDate,
    timezone: z.string(),
    stats: z.object({
      appointments: z.number().int(),
      confirmed: z.number().int(),
      noReply: z.number().int(),
      refilledFromWaitlist: z.number().int().openapi({
        description:
          'Refilled from the waitlist ON this local day (business timezone): replacement bookings whose claim happened on this day, for any appointment day. Cancelled replacements and unpaid deposit holds are not counted.',
      }),
    }),
    whatsappDue: z.number().int(),
    outcomesToMark: z.number().int(),
    staff: z.array(z.object({ id: z.string(), displayName: z.string() })),
    appointments: z.array(
      z.object({
        id: z.string(),
        startAt: iso,
        endAt: iso,
        status: z.string(),
        source: z.enum(['PUBLIC', 'FRONT_DESK', 'WAITLIST']),
        service: z.object({ id: z.string(), name: z.string(), durationMin: z.number().int() }),
        staff: z.object({ id: z.string(), displayName: z.string() }),
        client: z.object({
          id: z.string(),
          name: z.string(),
          phone: z.string(),
          noShows: z.number().int(),
          repeatNoShow: z.boolean(),
        }),
        confirmedAt: iso.nullable(),
        reminders: z.object({ whatsappPending: z.boolean() }),
      }),
    ),
  }),
);

registry.registerPath({
  method: 'get',
  path: '/api/dashboard/summary',
  summary: 'Badge counts: WhatsApp reminders due and outcomes to mark',
  tags: ['dashboard'],
  security: session,
  responses: {
    200: { description: 'Counts', content: json(SummaryDto) },
    401: errorResponses[401],
    403: errorResponses[403],
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/dashboard/today',
  summary: 'One local day for the dashboard: stats, staff columns and every appointment',
  tags: ['dashboard'],
  security: session,
  request: { query: TodayQuery },
  responses: {
    200: { description: 'Day', content: json(TodayDto) },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
  },
});
