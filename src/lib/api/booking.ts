import { z } from 'zod';
import { ApiError, request } from './auth';

// Typed client for the public booking endpoints (`/api/public/{slug}`). Responses are validated;
// unknown extra keys are ignored. Errors are ApiError (see auth.ts).

export const publicServiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  durationMin: z.number(),
  bufferMin: z.number(),
  price: z.number(),
});
export const publicStaffSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  serviceIds: z.array(z.string()),
});
export const publicBusinessSchema = z.object({
  business: z.object({
    name: z.string(),
    slug: z.string(),
    timezone: z.string(),
    locale: z.string(),
    category: z.string().nullish(),
    address: z.string().nullish(),
  }),
  services: z.array(publicServiceSchema),
  staff: z.array(publicStaffSchema),
});
export type PublicBusiness = z.infer<typeof publicBusinessSchema>;
export type PublicService = z.infer<typeof publicServiceSchema>;
export type PublicStaff = z.infer<typeof publicStaffSchema>;

export const slotSchema = z.object({
  startAt: z.string(),
  endAt: z.string(),
  staffId: z.string().optional(),
});
export const slotsSchema = z.object({ slots: z.array(slotSchema) });
export type Slot = z.infer<typeof slotSchema>;

export const bookingResultSchema = z.object({
  appointment: z.object({
    id: z.string(),
    startAt: z.string(),
    endAt: z.string(),
    status: z.string(),
    service: z.object({
      id: z.string(),
      name: z.string(),
      durationMin: z.number(),
      price: z.number(),
    }),
    staff: z.object({ id: z.string(), displayName: z.string() }),
  }),
  links: z.object({ manage: z.string() }),
});
export type BookingResult = z.infer<typeof bookingResultSchema>;

export type BookingBody = {
  serviceId: string;
  /** A staff id, or the literal `anyone`. */
  staffId: string;
  /** ISO 8601 UTC instant. */
  startAt: string;
  client: { name: string; phone: string; email?: string };
};

const seg = encodeURIComponent;

export const getPublicBusiness = (slug: string, signal?: AbortSignal) =>
  request(`/api/public/${seg(slug)}`, publicBusinessSchema, { signal });

export type SlotsQuery = {
  serviceId: string;
  /** Omit for "anyone": entries then carry no staffId. */
  staffId?: string;
  /** Local dates in the business timezone, inclusive. */
  from: string;
  to: string;
};

export const getSlots = (slug: string, q: SlotsQuery, signal?: AbortSignal) => {
  const params = new URLSearchParams({ serviceId: q.serviceId, from: q.from, to: q.to });
  if (q.staffId) params.set('staffId', q.staffId);
  return request(`/api/public/${seg(slug)}/slots?${params}`, slotsSchema, { signal }).then(
    (r) => r.slots,
  );
};

/** One `Idempotency-Key` per booking attempt: retries of the same attempt reuse it (see lib/booking/attempt.ts). */
export const createBooking = (slug: string, body: BookingBody, idempotencyKey: string) =>
  request(`/api/public/${seg(slug)}/bookings`, bookingResultSchema, {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });

/** Front-desk booking (staff session): same engine and body as the public page, but no minimum notice. */
export const createFrontDeskBooking = (body: BookingBody, idempotencyKey: string) =>
  request('/api/appointments', bookingResultSchema, {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });

/** The fresh slots the server attaches to a 409 SLOT_TAKEN (`error.data.slots`); empty when absent or malformed. */
export function slotsFromConflict(error: unknown): Slot[] {
  if (!(error instanceof ApiError)) return [];
  const parsed = slotsSchema.safeParse(error.data);
  return parsed.success ? parsed.data.slots : [];
}
