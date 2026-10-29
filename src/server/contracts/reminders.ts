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
  z.object({ expired: z.number().int(), offered: z.number().int() }),
);
export const CleanupSummaryDto = registry.register(
  'CleanupSummary',
  z.object({
    sessions: z.number().int(),
    invites: z.number().int(),
    rateLimitBuckets: z.number().int(),
    truncated: z.boolean(),
  }),
);

const LinkView = z.object({
  act: z.enum(['view', 'confirm', 'cancel']),
  appointment: z.object({
    id: z.string(),
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
        kind: z.enum(['H24', 'H2']),
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
  summary: 'Expire waitlist offers (cron)',
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
  summary: 'WhatsApp reminders due now, plus those sent in the last 12 hours',
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
