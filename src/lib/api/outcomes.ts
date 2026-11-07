import { z } from 'zod';
import { request } from './auth';

// Typed client for outcomes, appointments and clients. Responses are validated but tolerant: unknown extra
// keys are ignored. Errors are ApiError (see auth.ts).

export const OUTCOMES = ['ATTENDED', 'NO_SHOW', 'LATE_CANCEL'] as const;
export type Outcome = (typeof OUTCOMES)[number];

const person = z.object({ id: z.string(), name: z.string() });
const staffRef = z.object({ id: z.string(), displayName: z.string() });

export const queueItemSchema = z.object({
  id: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  service: person,
  staff: staffRef,
  // A barber's queue carries only the client's first name and phone.
  client: z.object({
    id: z.string().default(''),
    name: z.string(),
    phone: z.string(),
    noShows: z.number().int().default(0),
  }),
});
export type QueueItem = z.infer<typeof queueItemSchema>;

export const queueSchema = z.object({ count: z.number().int(), items: z.array(queueItemSchema) });
export type OutcomeQueue = z.infer<typeof queueSchema>;

export const outcomeResultSchema = z.object({
  appointment: z.object({
    id: z.string(),
    status: z.string(),
    startAt: z.string(),
    endAt: z.string(),
    client: z.object({
      id: z.string().default(''),
      name: z.string(),
      phone: z.string(),
      attended: z.number().int().default(0),
      noShows: z.number().int().default(0),
      lateCancels: z.number().int().default(0),
    }),
  }),
});
export type OutcomeResult = z.infer<typeof outcomeResultSchema>;

export const getOutcomeQueue = (limit = 100, signal?: AbortSignal) =>
  request(`/api/outcomes/queue?limit=${limit}`, queueSchema, { signal });

export const markOutcome = (id: string, outcome: Outcome) =>
  request(`/api/appointments/${encodeURIComponent(id)}/outcome`, outcomeResultSchema, {
    method: 'PATCH',
    body: { outcome },
  });

/** Turn a no-show or late cancel into a normal cancellation and take it off the client's history counters. */
export const excuseAppointment = (id: string) =>
  request(`/api/appointments/${encodeURIComponent(id)}/excuse`, outcomeResultSchema, {
    method: 'POST',
    body: {},
  });

// ---- One appointment -------------------------------------------------------------------------------

export const appointmentSchema = z.object({
  appointment: z.object({
    id: z.string(),
    /** Owner / staff screens only (the barber's shape has none). */
    reference: z.string().nullable().optional(),
    startAt: z.string(),
    endAt: z.string(),
    status: z.string(),
    source: z.string().default('PUBLIC'),
    confirmedAt: z.string().nullable().optional(),
    /** Staff-only: where reminder emails go (same rule as the reminder runner); null = no usable address. */
    reminderEmail: z.string().nullable().optional(),
    reminderEmailDiffers: z.boolean().optional(),
    /** Staff-only: what was typed for THIS booking (null = nothing, the client record is used). */
    contactEmail: z.string().nullable().optional(),
    contactName: z.string().nullable().optional(),
    service: z.object({
      id: z.string(),
      name: z.string(),
      durationMin: z.number().optional(),
      price: z.union([z.number(), z.string()]).optional(),
    }),
    staff: staffRef,
    client: z.object({
      id: z.string().default(''),
      name: z.string(),
      phone: z.string(),
      noShows: z.number().int().default(0),
      repeatNoShow: z.boolean().default(false),
      lateCancels: z.number().int().optional(),
    }),
  }),
});
export type AppointmentDetail = z.infer<typeof appointmentSchema>['appointment'];

export const getAppointment = (id: string, signal?: AbortSignal) =>
  request(`/api/appointments/${encodeURIComponent(id)}`, appointmentSchema, { signal }).then(
    (r) => r.appointment,
  );

/**
 * F69-C: correct THIS booking's contact email and/or name. `null` clears. The client record is not changed.
 * Answers with the refreshed appointment (including the staff-only `reminderEmail` line).
 */
export const updateContact = (
  id: string,
  body: { contactEmail?: string | null; contactName?: string | null },
) =>
  request(`/api/appointments/${encodeURIComponent(id)}/contact`, appointmentSchema, {
    method: 'PATCH',
    body,
  }).then((r) => r.appointment);

// ---- Clients ---------------------------------------------------------------------------------------

export const CLIENT_SORTS = ['name', 'noShows', 'recent'] as const;
export type ClientSort = (typeof CLIENT_SORTS)[number];

export const clientRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  attended: z.number().int(),
  noShows: z.number().int(),
  lateCancels: z.number().int(),
  lastVisitAt: z.string().nullable(),
  repeatNoShow: z.boolean(),
});
export type ClientRow = z.infer<typeof clientRowSchema>;

export const clientListSchema = z.object({
  clients: z.array(clientRowSchema),
  nextCursor: z.string().nullable(),
});
export type ClientPage = z.infer<typeof clientListSchema>;

export const CLIENT_PAGE_SIZE = 25;

export function getClients(
  params: { search?: string; sort: ClientSort; cursor?: string | null },
  signal?: AbortSignal,
) {
  const q = new URLSearchParams({ sort: params.sort, limit: String(CLIENT_PAGE_SIZE) });
  const search = params.search?.trim();
  if (search) q.set('search', search);
  if (params.cursor) q.set('cursor', params.cursor);
  return request(`/api/clients?${q.toString()}`, clientListSchema, { signal });
}

export const historyItemSchema = z.object({
  id: z.string(),
  startAt: z.string(),
  status: z.string(),
  service: person,
  staff: staffRef,
});
export type HistoryItem = z.infer<typeof historyItemSchema>;

export const clientDetailSchema = z.object({
  client: clientRowSchema.extend({ createdAt: z.string() }),
  history: z.array(historyItemSchema),
});
export type ClientDetail = z.infer<typeof clientDetailSchema>;

export const getClient = (id: string, signal?: AbortSignal) =>
  request(`/api/clients/${encodeURIComponent(id)}`, clientDetailSchema, { signal });

/** Owner only. 204: the client is anonymised and future bookings are cancelled. */
export const deleteClient = (id: string) =>
  request(`/api/clients/${encodeURIComponent(id)}`, z.unknown(), { method: 'DELETE' });
