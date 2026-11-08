import { z } from 'zod';
import { RemindersDto } from './booking';
import { LinkParams } from './reminders';
import { ErrorResponse, errorResponses, registry } from './registry';

const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });
const err = (description: string) => ({ description, content: json(ErrorResponse) });

export const PayParams = LinkParams;
/**
 * POST /api/pay/{token} takes an empty body (success, the original contract) or ONLY `{ scenario }`: the outcome
 * the TEST card form simulates. Card data is never part of it (unknown keys are a 400).
 */
export const PayBody = registry.register(
  'PayBody',
  z.object({ scenario: z.enum(['success', 'declined']).optional() }).strict(),
);

export const PayViewDto = registry.register(
  'PayView',
  z.object({
    state: z.enum(['PENDING', 'PAID']),
    appointment: z.object({
      id: z.string(),
      startAt: z.string().datetime(),
      endAt: z.string().datetime(),
      status: z.string(),
      service: z.object({
        id: z.string(),
        name: z.string(),
        durationMin: z.number().int(),
        price: z.number().describe('The full price of the service (the board Total). Not the deposit.'),
      }),
      staff: z.object({ id: z.string(), displayName: z.string() }),
    }),
    business: z.object({
      name: z.string(),
      slug: z.string(),
      timezone: z.string(),
      locale: z.string(),
      address: z
        .string()
        .optional()
        .describe('The public address of the business, as on its booking page. Omitted when none.'),
    }),
    deposit: z.object({ amount: z.number(), currency: z.string() }),
    holdExpiresAt: z.string().datetime().nullable(),
    /** The server clock, for the countdown. */
    now: z.string().datetime(),
    /** True while the payment provider is the fake: no card is ever charged or collected. */
    testMode: z.boolean(),
    /** The reminders created when the deposit was paid (all false while state is PENDING). */
    reminders: RemindersDto,
  }),
);

const expired = err(
  'HOLD_EXPIRED (the hold lapsed unpaid) or BOOKING_CANCELLED (it was cancelled), both with `error.data` { slug, serviceId, slots } (fresh slots for that day); the slot was released',
);

registry.registerPath({
  method: 'get',
  path: '/api/pay/{token}',
  summary: 'Deposit pay page data (signed `pay` token, no side effects)',
  description:
    'The token expires when the 15 minute hold does. Wrong signature, wrong scope (a confirm/cancel/claim token) or an unknown appointment is 404.',
  tags: ['deposit'],
  request: { params: PayParams },
  responses: {
    200: { description: 'The pending deposit, or the paid booking', content: json(PayViewDto) },
    400: errorResponses[400],
    404: errorResponses[404],
    410: expired,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/pay/{token}',
  summary: 'Pay the deposit (TEST MODE: completes through the fake payment provider)',
  description:
    'Only the provider result flips the appointment from PENDING_PAYMENT to BOOKED, with no confirmedAt: the client can still confirm by link (Payment PAID, reminders created, once). Repeating it returns 200 and changes nothing. Never takes card data.',
  tags: ['deposit'],
  request: { params: PayParams, body: { content: json(PayBody) } },
  responses: {
    200: { description: 'Paid and confirmed (or already was)', content: json(PayViewDto) },
    400: errorResponses[400],
    404: errorResponses[404],
    409: err(
      'PAYMENT_DECLINED (scenario "declined": the hold is kept, nothing changes) or PAYMENT_NOT_COMPLETED: the provider did not report the payment as paid',
    ),
    410: expired,
  },
});
