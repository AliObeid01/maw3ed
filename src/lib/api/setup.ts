import { z } from 'zod';
import type { BusinessArea, BusinessCategory } from '@/lib/business/profile';
import { request } from './auth';

// Typed client for the owner setup endpoints. Responses are validated; unknown extra keys are ignored.
// Errors are ApiError (see auth.ts): `NETWORK`, `BAD_RESPONSE`, or the server's error-envelope code.

export const SLOT_STEPS = [5, 10, 15, 20, 30, 60] as const;

const nullableText = z.string().nullable();

export const businessSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  timezone: z.string(),
  locale: z.string(),
  slotStepMin: z.number(),
  bookingWindowDays: z.number(),
  minNoticeMin: z.number(),
  cancelCutoffMin: z.number(),
  /** A category key, or legacy free text typed before keys existed. */
  category: nullableText,
  /** An area key (PR-1); null on rows that never set one. */
  area: nullableText.default(null),
  address: nullableText,
  /** Opted in to the public directory (default false). */
  listed: z.boolean().default(false),
  /** Deposit rules (FR-26). Off by default. */
  deposit: z
    .object({
      enabled: z.boolean(),
      threshold: z.number(),
      amount: z.number(),
      currency: z.string(),
    })
    .default({ enabled: false, threshold: 1, amount: 5, currency: 'USD' }),
  setup: z.object({
    hasServices: z.boolean(),
    hasBookableStaff: z.boolean(),
    hasHours: z.boolean(),
  }),
});
export type Business = z.infer<typeof businessSchema>;
export type SetupFlags = Business['setup'];

export type BusinessPatch = Partial<{
  name: string;
  timezone: string;
  slotStepMin: number;
  bookingWindowDays: number;
  minNoticeMin: number;
  cancelCutoffMin: number;
  category: BusinessCategory | null;
  area: BusinessArea | null;
  address: string | null;
  listed: boolean;
  depositEnabled: boolean;
  depositThreshold: number;
  depositAmount: number;
}>;

export const serviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  durationMin: z.number(),
  bufferMin: z.number(),
  price: z.number(),
  active: z.boolean(),
  sortOrder: z.number(),
});
export type Service = z.infer<typeof serviceSchema>;
const servicesSchema = z.object({ services: z.array(serviceSchema) });

export type ServiceInput = {
  name: string;
  durationMin: number;
  bufferMin: number;
  price: number;
};
export type ServicePatch = Partial<ServiceInput & { active: boolean; sortOrder: number }>;

export const staffSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  bookable: z.boolean(),
  active: z.boolean(),
  role: z.enum(['OWNER', 'STAFF']).nullable(),
  serviceIds: z.array(z.string()),
});
export type StaffMember = z.infer<typeof staffSchema>;
const staffListSchema = z.object({ staff: z.array(staffSchema) });
const serviceIdsSchema = z.object({ serviceIds: z.array(z.string()) });

export const intervalSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startLocal: z.string(),
  endLocal: z.string(),
});
export type HoursInterval = z.infer<typeof intervalSchema>;
const hoursSchema = z.object({ intervals: z.array(intervalSchema) });

export const TIME_OFF_REASONS = ['VACATION', 'SICK', 'OTHER'] as const;
export type TimeOffReason = (typeof TIME_OFF_REASONS)[number];
export const timeOffSchema = z.object({
  id: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  reason: z.enum(TIME_OFF_REASONS),
});
export type TimeOff = z.infer<typeof timeOffSchema>;
const timeOffListSchema = z.object({ items: z.array(timeOffSchema) });

export const pendingInviteSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
  expiresAt: z.string(),
});
export type PendingInvite = z.infer<typeof pendingInviteSchema>;
const invitesSchema = z.object({ invites: z.array(pendingInviteSchema) });
const createdInviteSchema = pendingInviteSchema.extend({ acceptUrl: z.string().optional() });
export type CreatedInvite = z.infer<typeof createdInviteSchema>;

const seg = encodeURIComponent;

// ---- Business ----
export const getBusiness = (signal?: AbortSignal) =>
  request('/api/business', businessSchema, { signal });
export const updateBusiness = (body: BusinessPatch) =>
  request('/api/business', businessSchema, { method: 'PATCH', body });

// ---- Services ----
export const listServices = (signal?: AbortSignal) =>
  request('/api/services', servicesSchema, { signal }).then((r) => r.services);
export const createService = (body: ServiceInput) =>
  request('/api/services', serviceSchema, { method: 'POST', body });
export const updateService = (id: string, body: ServicePatch) =>
  request(`/api/services/${seg(id)}`, serviceSchema, { method: 'PATCH', body });

// ---- Staff ----
export const listStaff = (signal?: AbortSignal) =>
  request('/api/staff', staffListSchema, { signal }).then((r) => r.staff);
export const createStaff = (body: {
  displayName: string;
  bookable: boolean;
  serviceIds: string[];
}) => request('/api/staff', staffSchema, { method: 'POST', body });
export const updateStaff = (
  id: string,
  body: Partial<{ displayName: string; bookable: boolean; active: boolean }>,
) => request(`/api/staff/${seg(id)}`, staffSchema, { method: 'PATCH', body });
export const setStaffServices = (id: string, serviceIds: string[]) =>
  request(`/api/staff/${seg(id)}/services`, serviceIdsSchema, {
    method: 'PUT',
    body: { serviceIds },
  }).then((r) => r.serviceIds);

// ---- Hours and time off ----
export const getStaffHours = (id: string, signal?: AbortSignal) =>
  request(`/api/staff/${seg(id)}/hours`, hoursSchema, { signal }).then((r) => r.intervals);
export const putStaffHours = (id: string, intervals: HoursInterval[]) =>
  request(`/api/staff/${seg(id)}/hours`, hoursSchema, {
    method: 'PUT',
    body: { intervals },
  }).then((r) => r.intervals);
export const listTimeOff = (id: string, signal?: AbortSignal) =>
  request(`/api/staff/${seg(id)}/time-off`, timeOffListSchema, { signal }).then((r) => r.items);
export const createTimeOff = (
  id: string,
  body: { startAt: string; endAt: string; reason: TimeOffReason },
) => request(`/api/staff/${seg(id)}/time-off`, timeOffSchema, { method: 'POST', body });
export const deleteTimeOff = (id: string, timeOffId: string) =>
  request(`/api/staff/${seg(id)}/time-off/${seg(timeOffId)}`, z.unknown(), { method: 'DELETE' });

// ---- Invites ----
export const listInvites = (signal?: AbortSignal) =>
  request('/api/invites', invitesSchema, { signal }).then((r) => r.invites);
export const createInvite = (body: { email: string; role: 'STAFF' }) =>
  request('/api/invites', createdInviteSchema, { method: 'POST', body });
