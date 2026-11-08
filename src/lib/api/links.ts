import { z } from 'zod';
import { request } from './auth';

// Typed client for the signed-link endpoints (`/api/links/{token}`): the confirm / cancel page.
// GET never changes anything; the actions are POSTs sent only on a button press.
//   404 -> unknown or malformed link, 410 LINK_EXPIRED -> the link stopped working at the appointment start,
//   403 WRONG_LINK_ACTION -> this token cannot do that action, 409 -> not allowed in the current state.

export const LINK_ACTIONS = ['view', 'confirm', 'cancel'] as const;
export type LinkAct = (typeof LINK_ACTIONS)[number];

export const linkSchema = z.object({
  act: z.enum(LINK_ACTIONS),
  appointment: z.object({
    id: z.string(),
    reference: z.string().nullable().default(null),
    startAt: z.string(),
    endAt: z.string(),
    /** BOOKED, CONFIRMED, PENDING_PAYMENT, CANCELLED, LATE_CANCEL, ATTENDED or NO_SHOW; unknown values are treated as still open. */
    status: z.string(),
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
  canConfirm: z.boolean(),
  canCancel: z.boolean(),
  cancelCutoffAt: z.string(),
  pastCutoff: z.boolean(),
  confirmedAt: z.string().nullable(),
});
export type LinkView = z.infer<typeof linkSchema>;

export const LINK_RESULTS = [
  'confirmed',
  'cancelled',
  'late_cancelled',
  'already_confirmed',
  'already_cancelled',
] as const;
export type LinkResult = (typeof LINK_RESULTS)[number];

export const linkActionResultSchema = linkSchema.extend({ result: z.enum(LINK_RESULTS) });
export type LinkActionResult = z.infer<typeof linkActionResultSchema>;

const path = (token: string) => `/api/links/${encodeURIComponent(token)}`;

export const getLink = (token: string, signal?: AbortSignal) =>
  request(path(token), linkSchema, { signal });

export const postLinkAction = (token: string, action: 'confirm' | 'cancel', signal?: AbortSignal) =>
  request(path(token), linkActionResultSchema, { method: 'POST', body: { action }, signal });
