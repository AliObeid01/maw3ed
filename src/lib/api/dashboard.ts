import { z } from 'zod';
import { ApiError, request } from './auth';
import { getOutcomeQueue } from './outcomes';

// Typed client for the receptionist dashboard. Responses are validated but tolerant: unknown extra keys are
// ignored (zod objects strip them). Errors are ApiError (see auth.ts).

export const summarySchema = z.object({
  whatsappDue: z.number().int().nonnegative(),
  outcomesToMark: z.number().int().nonnegative(),
});
export type DashboardSummary = z.infer<typeof summarySchema>;

/** Status values the UI has a look for. An unknown status from a newer server falls back to "booked". */
export const KNOWN_STATUSES = [
  'BOOKED',
  'CONFIRMED',
  'ATTENDED',
  'NO_SHOW',
  'LATE_CANCEL',
  'CANCELLED',
] as const;
export type KnownStatus = (typeof KNOWN_STATUSES)[number];

// A barber's (PRACTITIONER) day has no client id, counters, no-show flag, source or reminder state: those default
// here so the same agenda components render both shapes.
export const todayAppointmentSchema = z.object({
  id: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  status: z.string(),
  source: z.string().default('PUBLIC'),
  service: z.object({ id: z.string(), name: z.string(), durationMin: z.number() }),
  staff: z.object({ id: z.string(), displayName: z.string() }),
  client: z.object({
    id: z.string().default(''),
    name: z.string(),
    phone: z.string(),
    noShows: z.number().int().default(0),
    repeatNoShow: z.boolean().default(false),
  }),
  confirmedAt: z.string().nullable(),
  reminders: z.object({ whatsappPending: z.boolean() }).default({ whatsappPending: false }),
});
export type TodayAppointment = z.infer<typeof todayAppointmentSchema>;

export const todaySchema = z.object({
  date: z.string(),
  timezone: z.string(),
  stats: z.object({
    appointments: z.number().int(),
    confirmed: z.number().int().default(0),
    noReply: z.number().int().default(0),
    refilledFromWaitlist: z.number().int().default(0),
  }),
  whatsappDue: z.number().int().default(0),
  outcomesToMark: z.number().int(),
  staff: z.array(z.object({ id: z.string(), displayName: z.string() })),
  appointments: z.array(todayAppointmentSchema),
});
export type TodayData = z.infer<typeof todaySchema>;

export const waitlistActivitySchema = z.object({
  items: z.array(
    z.object({
      type: z.enum(['OFFERED', 'CLAIMED', 'EXPIRED']),
      at: z.string(),
      offerId: z.string(),
      slot: z.object({
        startAt: z.string(),
        service: z.object({ id: z.string(), name: z.string() }),
        staff: z.object({ id: z.string(), displayName: z.string() }),
      }),
      offeredTo: z.number().int(),
      claimedBy: z.object({ name: z.string() }).nullable(),
    }),
  ),
});
export type WaitlistActivity = z.infer<typeof waitlistActivitySchema>['items'][number];

export const getSummary = (signal?: AbortSignal) =>
  request('/api/dashboard/summary', summarySchema, { signal });

/**
 * The barber's nav badge. A PRACTITIONER may not call /api/dashboard/summary (owner routes stay closed), so the
 * count comes from their own scoped queue.
 */
export const getBarberSummary = (signal?: AbortSignal): Promise<DashboardSummary> =>
  getOutcomeQueue(1, signal).then((q) => ({ whatsappDue: 0, outcomesToMark: q.count }));

export const getToday = (date: string, signal?: AbortSignal) =>
  request(`/api/dashboard/today?date=${encodeURIComponent(date)}`, todaySchema, { signal });

export const getWaitlistActivity = (limit = 10, signal?: AbortSignal) =>
  request(`/api/waitlist/activity?limit=${limit}`, waitlistActivitySchema, { signal }).then(
    (r) => r.items,
  );

export const cancelAppointment = (id: string) =>
  request(`/api/appointments/${encodeURIComponent(id)}/cancel`, z.unknown(), { method: 'POST' });

// ---- Client lookup (front-desk booking) --------------------------------------------------------

const clientHitSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  noShows: z.number().int().optional(),
  visits: z.number().int().optional(),
});
export type ClientHit = {
  id: string;
  name: string;
  phone: string;
  noShows: number;
  visits: number | undefined;
};
// The clients API is still being built: accept `{ clients }` or `{ items }`.
const clientSearchSchema = z.union([
  z.object({ clients: z.array(clientHitSchema) }).transform((r) => r.clients),
  z.object({ items: z.array(clientHitSchema) }).transform((r) => r.items),
]);

/** Clients matching a phone fragment. A 404 (endpoint not deployed yet) is "no match", never an error. */
export async function searchClients(digits: string, signal?: AbortSignal): Promise<ClientHit[]> {
  try {
    const hits = await request(
      `/api/clients?search=${encodeURIComponent(digits)}`,
      clientSearchSchema,
      { signal },
    );
    return hits.map((h) => ({
      id: h.id,
      name: h.name,
      phone: h.phone,
      noShows: h.noShows ?? 0,
      visits: h.visits,
    }));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return [];
    throw error;
  }
}
