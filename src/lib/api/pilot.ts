import { z } from 'zod';
import { request } from './auth';

const localDate = z.string();
export const baselineSchema = z.object({
  fromDate: localDate,
  toDate: localDate,
  appointments: z.number().int(),
  noShows: z.number().int(),
  lateCancels: z.number().int(),
});
export type Baseline = z.infer<typeof baselineSchema>;
export type BaselineInput = Baseline;

const baselineResponse = z.object({ baseline: baselineSchema.nullable() });

const nullableNumber = z.number().nullable();
export const reportSchema = z.object({
  rateDefinition: z.string().optional(),
  baselineDefinition: z.string().optional(),
  baseline: baselineSchema.nullable(),
  pilot: z.object({
    fromDate: localDate,
    toDate: localDate,
    daysCovered: z.number().int(),
    appointments: z.number().int(),
    attended: z.number().int(),
    noShows: z.number().int(),
    lateCancels: z.number().int(),
    noShowRate: nullableNumber,
    baselineRate: nullableNumber,
    changePoints: nullableNumber,
    changeRelativePct: nullableNumber,
  }),
  weekly: z.array(
    z.object({
      weekStart: localDate,
      appointments: z.number().int(),
      attended: z.number().int(),
      noShows: z.number().int(),
      lateCancels: z.number().int(),
      noShowRate: nullableNumber,
    }),
  ),
  signals: z.object({
    confirmRate: nullableNumber,
    cancellationsViaLink: z.number().int(),
    waitlistSlotsOffered: z.number().int(),
    waitlistRefills: z.number().int(),
    waitlistRefillRate: nullableNumber,
  }),
});
export type PilotReport = z.infer<typeof reportSchema>;

export const REPORT_WEEKS = [4, 8, 12] as const;
export type ReportWeeks = (typeof REPORT_WEEKS)[number];

export const getBaseline = (signal?: AbortSignal) =>
  request('/api/pilot/baseline', baselineResponse, { signal }).then((r) => r.baseline);

export const putBaseline = (body: BaselineInput) =>
  request('/api/pilot/baseline', baselineResponse, { method: 'PUT', body }).then(
    (r) => r.baseline,
  );

export const getReport = (weeks: number, signal?: AbortSignal) =>
  request(`/api/pilot/report?weeks=${weeks}`, reportSchema, { signal });
