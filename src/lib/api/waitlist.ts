import { z } from 'zod';
import { bookingResultSchema } from './booking';
import { serverOffsetMs } from '@/lib/waitlist/clock';
import { request } from './auth';

// Typed client for the waitlist endpoints. Responses are validated; unknown extra keys are ignored.
//   POST /api/public/{slug}/waitlist   201 joined, 200 already on the list, 409 WAITLIST_LIMIT, 400 fields, 429
//   GET  /api/offers/{token}           no side effects; 404 invalid, 410 OFFER_EXPIRED
//   POST /api/offers/{token}/claim     201 booked, 200 replay, 409 SLOT_TAKEN | CONFLICT, 410 OFFER_EXPIRED

export type JoinWaitlistBody = {
  serviceId: string;
  /** A staff id, or null for anyone. */
  staffId: string | null;
  /** Local dates in the business timezone, `yyyy-MM-dd`. */
  fromDate: string;
  toDate: string;
  client: { name: string; phone: string; email: string };
};

export const waitlistJoinedSchema = z.object({
  entry: z.object({
    id: z.string(),
    status: z.string(),
    serviceId: z.string(),
    staffId: z.string().nullable(),
    fromDate: z.string(),
    toDate: z.string(),
  }),
});
export type WaitlistJoined = z.infer<typeof waitlistJoinedSchema>;

export const OFFER_STATUSES = [
  'OPEN',
  'CLAIMED',
  'EXPIRED',
  'TAKEN',
  'UNAVAILABLE',
  'ALREADY_BOOKED',
  'HOLD_LAPSED',
] as const;

export const offerViewSchema = z.object({
  offer: z.object({
    id: z.string(),
    status: z.enum(OFFER_STATUSES),
    startAt: z.string(),
    endAt: z.string(),
    expiresAt: z.string(),
    service: z.object({
      id: z.string(),
      name: z.string(),
      durationMin: z.number(),
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
});
export type OfferView = z.infer<typeof offerViewSchema>;

const seg = encodeURIComponent;

export const joinWaitlist = (slug: string, body: JoinWaitlistBody) =>
  request(`/api/public/${seg(slug)}/waitlist`, waitlistJoinedSchema, { method: 'POST', body });

/** The offer plus the server clock offset taken from the response  header (0 when absent). */
export async function getOffer(token: string, signal?: AbortSignal) {
  let header: string | null = null;
  const view = await request(`/api/offers/${seg(token)}`, offerViewSchema, {
    signal,
    onResponse: (res) => {
      header = res.headers.get('date');
    },
  });
  return { ...view, clockOffsetMs: serverOffsetMs(header, Date.now()) };
}

/** The body is an empty strict object. A repeat of a successful claim answers 200 with the first booking. */
export const claimOffer = (token: string) =>
  request(`/api/offers/${seg(token)}/claim`, bookingResultSchema, { method: 'POST', body: {} });

export const leaveResultSchema = z.object({ removed: z.boolean() });

/** One-click removal from the waitlist (signed `leave` token). Idempotent. */
export const leaveWaitlist = (token: string) =>
  request(`/api/offers/${seg(token)}/leave`, leaveResultSchema, { method: 'POST', body: {} });
