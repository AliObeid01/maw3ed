import { z } from 'zod';
import { OptionalIdempotencyHeaders } from './booking';
import { ErrorResponse, errorResponses, registry } from './registry';

const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });
const security = [{ session: [] }];
const e = errorResponses;

/** GET takes no query; unknown keys are a 400. */
export const BillingQuery = z.object({}).strict();

export const CheckoutBody = registry.register(
  'CheckoutBody',
  z
    .object({
      plan: z.literal('PRO'),
      scenario: z
        .enum(['success', 'declined'])
        .optional()
        .describe(
          'TEST MODE simulation outcome chosen by the checkout page from the typed test card. Omitted means success. Card details are never part of the request.',
        ),
    })
    .strict(),
);
export const DowngradeBody = registry.register(
  'DowngradeBody',
  z.object({ plan: z.literal('FREE') }).strict(),
);

export const BillingDto = registry.register(
  'Billing',
  z.object({
    plan: z.enum(['FREE', 'PRO']),
    limits: z.object({ bookableStaff: z.number().int().nullable() }),
    usage: z.object({ bookableStaff: z.number().int() }),
    price: z.object({ amount: z.number(), currency: z.string() }),
    /** True while the payment provider is the fake: no card is charged. */
    testMode: z.boolean(),
  }),
);
export type BillingDtoT = z.infer<typeof BillingDto>;

registry.registerPath({
  method: 'get',
  path: '/api/billing',
  summary: 'Current plan, limits and usage of bookable staff (owner)',
  tags: ['billing'],
  security,
  request: { query: BillingQuery },
  responses: {
    200: { description: 'Billing summary', content: json(BillingDto) },
    400: e[400],
    401: e[401],
    403: e[403],
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/billing/checkout',
  summary:
    'Test checkout for Pro (owner). Records one Payment and sets the plan in one transaction; repeating it is a no-op. TEST MODE: no card is ever taken',
  tags: ['billing'],
  security,
  request: { headers: OptionalIdempotencyHeaders, body: { content: json(CheckoutBody) } },
  responses: {
    200: { description: 'Now on Pro (or already was)', content: json(BillingDto) },
    400: e[400],
    401: e[401],
    403: e[403],
    409: {
      description:
        'PAYMENT_DECLINED (scenario "declined": nothing is charged or changed), PAYMENT_NOT_COMPLETED (test payment did not complete) or CONFLICT (stale replayed session)',
      content: json(ErrorResponse),
    },
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/billing/downgrade',
  summary:
    'Back to Free (owner). 409 PLAN_LIMIT with { limit, current } when more bookable staff are active than Free allows',
  tags: ['billing'],
  security,
  request: { body: { content: json(DowngradeBody) } },
  responses: {
    200: { description: 'Now on Free (or already was)', content: json(BillingDto) },
    400: e[400],
    401: e[401],
    403: e[403],
    409: { description: 'PLAN_LIMIT', content: json(ErrorResponse) },
  },
});
