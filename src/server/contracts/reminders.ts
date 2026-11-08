import { z } from 'zod';
import { ErrorResponse, errorResponses, registry } from './registry';

const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });
const err = (description: string) => ({ description, content: json(ErrorResponse) });
const iso = z.string().datetime();

export const NoQuery = z.object({}).strict();
export const LinkParams = z.object({ token: z.string().min(1).max(600) }).strict();
export const ReminderParams = z.object({ id: z.string().cuid2() }).strict();
export const LinkActionBody = registry.register(
  'LinkActionBody',
  z.object({ action: z.enum(['confirm', 'cancel']) }).strict(),
);

export const RunSummaryDto = registry.register(
  'ReminderRunSummary',
  z.object({
    claimed: z.number().int(),
    sent: z.number().int(),
    skipped: z.number().int(),
    failed: z.number().int(),
    requeued: z.number().int(),
  }),
);
export const ExpirySummaryDto = registry.register(
  'WaitlistExpirySummary',
  z.object({
    expired: z.number().int(),
    offered: z.number().int(),
    holdsExpired: z
      .number()
      .int()
      .openapi({
        description:
          'Lapsed deposit holds (PENDING_PAYMENT) cancelled and offered to the waitlist.',
      }),
  }),
);
export const CleanupSummaryDto = registry.register(
  'CleanupSummary',
  z.object({
    sessions: z.number().int(),
    invites: z.number().int(),
    emailTokens: z.number().int(),
    activationTokens: z
      .number()
      .int()
      .openapi({ description: 'Staff activation links used or expired more than 7 days ago.' }),
    rateLimitBuckets: z.number().int(),
    truncated: z.boolean(),
  }),
);

const LinkView = z.object({
  act: z.enum(['view', 'confirm', 'cancel']),
  appointment: z.object({
    id: z.string(),
    reference: z
      .string()
      .nullable()
      .openapi({ description: 'Short booking code. A label only, never a credential.' }),
    startAt: iso,
    endAt: iso,
    status: z.string(),
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
  canConfirm: z.boolean(),
  canCancel: z.boolean(),
  cancelCutoffAt: iso,
  pastCutoff: z.boolean(),
  confirmedAt: iso.nullable(),
});
export const LinkViewDto = registry.register('LinkView', LinkView);
export const LinkResultDto = registry.register(
  'LinkResult',
  LinkView.extend({
    result: z.enum([
      'confirmed',
      'cancelled',
      'late_cancelled',
      'already_confirmed',
      'already_cancelled',
    ]),
  }),
);

const person = z.object({ id: z.string(), name: z.string() });
export const WhatsappDueDto = registry.register(
  'WhatsappDue',
  z.object({
    count: z.number().int(),
    items: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(['H24', 'H2', 'LATE']).openapi({
          description:
            'H24 and H2 are the reminders. LATE is a public booking made less than 2 h before the slot: it is due at once, shown until the appointment starts, and its text is a booking confirmation.',
        }),
        dueAt: iso,
        appointment: z.object({
          id: z.string(),
          startAt: iso,
          service: z.object({ id: z.string(), name: z.string() }),
          staff: z.object({ id: z.string(), displayName: z.string() }),
        }),
        client: z.object({ name: z.string(), phone: z.string(), noShows: z.number().int() }),
        whatsappUrl: z.string().nullable(),
        phoneInvalid: z.boolean(),
        status: z.enum(['PENDING', 'SENT']),
        sentBy: person.nullable(),
        sentAt: iso.nullable(),
      }),
    ),
  }),
);
export const MarkSentDto = registry.register(
  'WhatsappMarkSent',
  z.object({
    id: z.string(),
    status: z.literal('SENT'),
    sentBy: person.nullable(),
    sentAt: iso.nullable(),
  }),
);

const cron = [{ cronSecret: [] }];

registry.registerPath({
  method: 'post',
  path: '/api/jobs/reminders',
  summary: 'Send due reminder emails (cron every 5 min; idempotent)',
  tags: ['jobs'],
  security: cron,
  responses: {
    200: { description: 'Run summary', content: json(RunSummaryDto) },
    400: errorResponses[400],
    401: errorResponses[401],
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/jobs/waitlist-expiry',
  summary:
    'Expire waitlist offers and lapsed deposit holds, then offer freed slots (cron every 5 min; idempotent)',
  tags: ['jobs'],
  security: cron,
  responses: {
    200: { description: 'Expiry summary', content: json(ExpirySummaryDto) },
    400: errorResponses[400],
    401: errorResponses[401],
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/jobs/cleanup',
  summary: 'Purge expired sessions, stale invites and old rate-limit buckets (cron, daily)',
  tags: ['jobs'],
  security: cron,
  responses: {
    200: { description: 'Rows deleted', content: json(CleanupSummaryDto) },
    400: errorResponses[400],
    401: errorResponses[401],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/jobs/sentry-test',
  summary: 'Throw a deliberate server error to confirm error monitoring (manual, owner only)',
  description:
    'Verification of the Sentry setup. Fails closed: 401 without the cron secret, 404 when error monitoring is not active (no SENTRY_DSN, or not a Production deployment). Otherwise throws on purpose and answers 500 INTERNAL; one event arrives in Sentry. Does nothing else.',
  tags: ['jobs'],
  security: cron,
  responses: {
    400: errorResponses[400],
    401: errorResponses[401],
    404: errorResponses[404],
    500: err('INTERNAL: the deliberate error (expected)'),
  },
});

const linkErrors = {
  400: errorResponses[400],
  404: errorResponses[404],
  410: errorResponses[410],
};
registry.registerPath({
  method: 'get',
  path: '/api/links/{token}',
  summary: 'Read an appointment through a signed link (no side effects)',
  description:
    'Authenticated by the signed token in the path. Malformed or unknown tokens: 404. Expired: 410 LINK_EXPIRED.',
  tags: ['links'],
  request: { params: LinkParams },
  responses: { 200: { description: 'Appointment', content: json(LinkViewDto) }, ...linkErrors },
});
export const LinkOutcomeDto = registry.register(
  'LinkOutcome',
  z
    .object({
      completed: z.boolean().openapi({
        description:
          'true only when the appointment is ATTENDED. false for every other state (booked, confirmed, cancelled, late cancel, no-show, pending payment, not yet marked, or unknown): the outcome cannot be inferred from it.',
      }),
    })
    .strict(),
);
registry.registerPath({
  method: 'get',
  path: '/api/links/{token}/outcome',
  summary: 'Was this visit attended? (read-only, works up to 90 days after the start)',
  description:
    'Accepts a signed `view` token (and only `view`) until 90 days after the appointment start, unlike the other link routes which expire at the start. Answers exactly `{ "completed": true }` for an ATTENDED appointment and the byte-identical `{ "completed": false }` for every other state, including an unknown appointment, so no-show, late cancellation or an excused absence cannot be inferred. Invalid signature, wrong action (confirm, cancel, claim), a token older than the grace or a malformed token: 404 NOT_FOUND (never 410). `Cache-Control: no-store`. Shares the `linkRead` per-IP limit.',
  tags: ['links'],
  request: { params: LinkParams, query: NoQuery },
  responses: {
    200: { description: 'Outcome', content: json(LinkOutcomeDto) },
    400: errorResponses[400],
    404: errorResponses[404],
    429: { description: 'RATE_LIMITED (Retry-After header)' },
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/links/{token}',
  summary: 'Confirm or cancel through a signed link',
  description:
    'A confirm token can only confirm, a cancel token only cancel (403 WRONG_LINK_ACTION); a view token may do either. Repeats answer 200 with already_* results.',
  tags: ['links'],
  request: { params: LinkParams, body: { content: json(LinkActionBody) } },
  responses: {
    200: { description: 'Result', content: json(LinkResultDto) },
    403: err('WRONG_LINK_ACTION'),
    409: err('CONFLICT: the appointment is cancelled or has an outcome'),
    ...linkErrors,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/reminders/whatsapp-due',
  summary:
    'WhatsApp reminders and last-minute bookings due now, plus those sent in the last 12 hours',
  tags: ['reminders'],
  security: [{ session: [] }],
  responses: {
    200: { description: 'Due list', content: json(WhatsappDueDto) },
    401: errorResponses[401],
    403: errorResponses[403],
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/reminders/{id}/mark-sent',
  summary: 'Record that this WhatsApp reminder was sent (first caller wins)',
  tags: ['reminders'],
  security: [{ session: [] }],
  request: { params: ReminderParams },
  responses: {
    200: { description: 'Marked', content: json(MarkSentDto) },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: err('ALREADY_SENT with error.data { sentBy, sentAt }'),
  },
});
