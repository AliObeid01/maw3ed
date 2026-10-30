import { z } from 'zod';
import { request } from './auth';

// Typed client for the owner billing endpoints. TEST MODE: no card details are ever sent or collected.

export const billingSchema = z.object({
  plan: z.enum(['FREE', 'PRO']),
  limits: z.object({ bookableStaff: z.number().nullable() }),
  usage: z.object({ bookableStaff: z.number() }),
  price: z.object({ amount: z.number(), currency: z.string() }),
  testMode: z.boolean(),
});
export type Billing = z.infer<typeof billingSchema>;

export const getBilling = (signal?: AbortSignal) =>
  request('/api/billing', billingSchema, { signal });

/** `idempotencyKey` makes a double tap harmless. */
export const checkoutPro = (idempotencyKey: string) =>
  request('/api/billing/checkout', billingSchema, {
    method: 'POST',
    body: { plan: 'PRO' },
    headers: { 'Idempotency-Key': idempotencyKey },
  });

export const downgradeToFree = () =>
  request('/api/billing/downgrade', billingSchema, { method: 'POST', body: { plan: 'FREE' } });
