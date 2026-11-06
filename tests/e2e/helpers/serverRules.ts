import { z } from 'zod';
import { ADDRESS_MAX, AREA_KEYS, CATEGORY_KEYS } from '../../../src/lib/business/profile';

/**
 * Request rules copied from the real API so the page.route mock rejects what the server rejects.
 * Source of truth: src/server/contracts/setup.ts and src/server/domain/hours.ts (PR #12,
 * branch feat/p2-setup-api). Keep in step when those change. Unknown keys are rejected (`.strict()`).
 */
const price = z
  .number()
  .min(0)
  .max(100000)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'At most 2 decimals.');
const serviceName = z.string().trim().min(1).max(80);
const durationMin = z.number().int().min(5).max(600);
const bufferMin = z.number().int().min(0).max(120);
const displayName = z.string().trim().min(1).max(60);
const nullableText = (max: number) => z.string().trim().max(max).nullable();

export const rules = {
  updateBusiness: z
    .object({
      name: z.string().trim().min(1).max(80),
      timezone: z.string().trim().min(1),
      slotStepMin: z.union([
        z.literal(5),
        z.literal(10),
        z.literal(15),
        z.literal(20),
        z.literal(30),
        z.literal(60),
      ]),
      bookingWindowDays: z.number().int().min(1).max(365),
      minNoticeMin: z.number().int().min(0).max(10080),
      cancelCutoffMin: z.number().int().min(0).max(10080),
      category: z.enum(CATEGORY_KEYS).nullable(),
      area: z.enum(AREA_KEYS).nullable(),
      address: nullableText(ADDRESS_MAX).refine((v) => v === null || !v.includes('\u0000'), 'Remove the NUL character.'),
      listed: z.boolean(),
    })
    .partial()
    .strict(),
  createService: z
    .object({ name: serviceName, durationMin, bufferMin: bufferMin.default(0), price })
    .strict(),
  updateService: z
    .object({
      name: serviceName,
      durationMin,
      bufferMin,
      price,
      active: z.boolean(),
      sortOrder: z.number().int().min(0).max(10000),
    })
    .partial()
    .strict(),
  createStaff: z
    .object({ displayName, bookable: z.boolean(), serviceIds: z.array(z.string()).max(200) })
    .strict(),
  updateStaff: z
    .object({ displayName, bookable: z.boolean(), active: z.boolean() })
    .partial()
    .strict(),
  setStaffServices: z.object({ serviceIds: z.array(z.string()).max(200) }).strict(),
  createInvite: z.object({ email: z.string().trim().email(), role: z.literal('STAFF') }).strict(),
  createTimeOff: z
    .object({
      startAt: z.iso.datetime(),
      endAt: z.iso.datetime(),
      reason: z.enum(['VACATION', 'SICK', 'OTHER']),
    })
    .strict(),
};

const hhmmStart = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const hhmmEnd = z.string().regex(/^(?:([01]\d|2[0-3]):[0-5]\d|24:00)$/);
export const MAX_INTERVALS_PER_DAY = 6;
export const MAX_INTERVALS_TOTAL = 42;
const hoursBody = z
  .object({
    intervals: z
      .array(
        z
          .object({
            weekday: z.number().int().min(0).max(6),
            startLocal: hhmmStart,
            endLocal: hhmmEnd,
          })
          .strict(),
      )
      .max(MAX_INTERVALS_TOTAL),
  })
  .strict();

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};

/** `fields` for a 400, or undefined when the body is valid. Mirrors the server's error envelope. */
export function validate<S extends z.ZodType>(
  schema: S,
  body: unknown,
): { data: z.infer<S> } | { fields: Record<string, string> } {
  const parsed = schema.safeParse(body);
  if (parsed.success) return { data: parsed.data };
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? '_');
    fields[key] ??= issue.message;
  }
  return { fields };
}

/** Working-hours rules: shape, end after start, no overlap per weekday, 6 per day, 42 in total. */
export function validateHours(body: unknown) {
  const shape = validate(hoursBody, body);
  if ('fields' in shape) return shape;
  const { intervals } = shape.data;
  const bad = (message: string) => ({ fields: { intervals: message } });
  if (intervals.some((i) => minutes(i.endLocal) <= minutes(i.startLocal)))
    return bad('End must be after start.');
  for (let day = 0; day < 7; day++) {
    const list = intervals
      .filter((i) => i.weekday === day)
      .map((i) => ({ s: minutes(i.startLocal), e: minutes(i.endLocal) }))
      .sort((a, b) => a.s - b.s);
    if (list.length > MAX_INTERVALS_PER_DAY) return bad('At most 6 intervals per day.');
    for (let k = 1; k < list.length; k++)
      if (list[k]!.s < list[k - 1]!.e) return bad('Overlaps another interval on the same day.');
  }
  return { data: shape.data };
}
