import { z } from 'zod';
import { ApiError, request } from './auth';
import { remindersSchema, slotSchema } from './booking';

// Typed client for the deposit pay page (`/api/pay/{token}`). TEST MODE: no card is ever collected, the
// page sends only the simulated scenario and the server asks the payment provider.
//   GET  200 -> the pending deposit (or the paid booking), 404 -> unknown link, 410 HOLD_EXPIRED -> lapsed.
//   POST 200 -> paid and confirmed (a repeat answers the same), 409 PAYMENT_NOT_COMPLETED, 410 HOLD_EXPIRED.

export const payViewSchema = z.object({
  state: z.enum(['PENDING', 'PAID']),
  appointment: z.object({
    id: z.string(),
    startAt: z.string(),
    endAt: z.string(),
    status: z.string(),
    service: z.object({ id: z.string(), name: z.string(), durationMin: z.number(), price: z.number() }),
    staff: z.object({ id: z.string(), displayName: z.string() }),
  }),
  business: z.object({
    name: z.string(),
    slug: z.string(),
    timezone: z.string(),
    locale: z.string(),
    address: z.string().optional(),
  }),
  deposit: z.object({ amount: z.number(), currency: z.string() }),
  holdExpiresAt: z.string().nullable(),
  now: z.string(),
  testMode: z.boolean(),
  reminders: remindersSchema,
});
export type PayView = z.infer<typeof payViewSchema>;

const seg = encodeURIComponent;
const path = (token: string) => `/api/pay/${seg(token)}`;

/** The view plus the server clock offset (from the `now` field), so the countdown ignores the phone clock. */
export async function getPay(token: string, signal?: AbortSignal) {
  const view = await request(path(token), payViewSchema, { signal });
  return { ...view, clockOffsetMs: Date.parse(view.now) - Date.now() };
}

/** Only the simulated outcome is sent (strict body); card digits never leave the form. Whether it was paid is the provider's word. */
export const postPay = (token: string, scenario: 'success' | 'declined' = 'success') =>
  request(path(token), payViewSchema, { method: 'POST', body: { scenario } });

const expiredDataSchema = z.object({
  slug: z.string().optional(),
  slots: z.array(slotSchema).default([]),
});

export type PayFailure =
  | 'invalid'
  | 'expired'
  | 'cancelled'
  | 'declined'
  | 'notPaid' | 'network' | 'busy' | 'generic';

export function classifyPayError(error: unknown): PayFailure {
  if (!(error instanceof ApiError)) return 'generic';
  if (error.status === 404 || error.status === 400) return 'invalid';
  if (error.status === 410) return error.code === 'BOOKING_CANCELLED' ? 'cancelled' : 'expired';
  if (error.status === 409 && error.code === 'PAYMENT_DECLINED') return 'declined';
  if (error.status === 409 && error.code === 'PAYMENT_NOT_COMPLETED') return 'notPaid';
  if (error.code === 'NETWORK') return 'network';
  if (error.status === 429 || error.status >= 500) return 'busy';
  return 'generic';
}

/** `error.data` of a 410 HOLD_EXPIRED: the business slug and the fresh slots of that day. */
export function expiredData(error: unknown): { slug?: string; slots: z.infer<typeof slotSchema>[] } {
  if (!(error instanceof ApiError)) return { slots: [] };
  const parsed = expiredDataSchema.safeParse(error.data);
  return parsed.success ? parsed.data : { slots: [] };
}
