import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AREA_KEYS, CATEGORY_KEYS } from '@/lib/business/profile';
import { mergeWeekIntervals } from '@/lib/setup/hoursMerge';
import { cleanText } from '@/server/mcp/sanitize';
import {
  findHoursProblem,
  MAX_INTERVALS_PER_DAY,
  MAX_INTERVALS_TOTAL,
  sortIntervals,
  type HoursInterval,
} from './hours';
import { isCents } from './money';
import { canAddBookableStaff, type PlanName } from './plan';

/**
 * The owner setup proposal: what Claude may ask Maw3ed to set up. A deliberately small, strict shape: services,
 * staff, weekly hours, category/area/address and three booking settings. Nothing else can be expressed (no
 * deletes, logins, roles, listing, plan, deposits, clients or appointments), and no email or phone number can be
 * typed into a name. Validation mirrors the dashboard (src/server/contracts/setup.ts). Pure.
 */
export const MAX_SERVICES = 20;
export const MAX_STAFF = 10;
export const MAX_NAME = 80;
export const MAX_STAFF_NAME = 60;
export const MAX_ADDRESS = 120;

const hasEmailOrPhone = (v: string) => v.includes('@') || v.replace(/\D/g, '').length >= 7;

/** Business-entered text: cleaned (invisibles, markup, newlines), not empty, and never an email or a phone. */
const text = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => cleanText(v, max))
    .refine((v) => v.length > 0, 'Use plain text.')
    .refine((v) => !hasEmailOrPhone(v), 'Do not include emails or phone numbers.');

const hhmmStart = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm (00:00 to 23:59).');
const hhmmEnd = z.string().regex(/^(?:([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'Use HH:mm (00:00 to 24:00).');

const ServiceIn = z
  .object({
    name: text(MAX_NAME),
    durationMin: z.number().int().min(5).max(600),
    price: z.number().min(0).max(100000).refine(isCents, 'At most 2 decimals.'),
  })
  .strict();

const StaffIn = z
  .object({ name: text(MAX_STAFF_NAME), services: z.array(text(MAX_NAME)).max(MAX_SERVICES) })
  .strict();

const DayIn = z
  .object({
    weekday: z.number().int().min(0).max(6).describe('0 = Sunday, 1 = Monday ... 6 = Saturday. A weekday that is not listed means closed.'),
    intervals: z
      .array(z.object({ start: hhmmStart, end: hhmmEnd }).strict())
      .max(MAX_INTERVALS_PER_DAY),
  })
  .strict();

const HoursIn = z
  .object({ staff: text(MAX_STAFF_NAME), days: z.array(DayIn).max(7) })
  .strict()
  .superRefine((h, ctx) => {
    if (new Set(h.days.map((d) => d.weekday)).size !== h.days.length)
      ctx.addIssue({ code: 'custom', message: 'List each weekday once.', path: ['days'] });
    const flat = flattenDays(h.days);
    if (flat.length > MAX_INTERVALS_TOTAL)
      ctx.addIssue({ code: 'custom', message: 'Too many intervals.', path: ['days'] });
    const problem = findHoursProblem(flat);
    if (problem) ctx.addIssue({ code: 'custom', message: problem.message, path: ['days'] });
  });

function flattenDays(days: { weekday: number; intervals: { start: string; end: string }[] }[]): HoursInterval[] {
  return days.flatMap((d) =>
    d.intervals.map((i) => ({ weekday: d.weekday, startLocal: i.start, endLocal: i.end })),
  );
}

export const ProposalSchema = z
  .object({
    profile: z
      .object({
        category: z.enum(CATEGORY_KEYS).optional(),
        area: z.enum(AREA_KEYS).optional(),
        address: text(MAX_ADDRESS).optional(),
      })
      .strict()
      .optional(),
    settings: z
      .object({
        slotStepMin: z
          .union([z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(60)])
          .describe('Minutes between bookable start times: 5, 10, 15, 20, 30 or 60.')
          .optional(),
        minNoticeMin: z.number().int().min(0).max(10080).describe('Minimum notice before a booking, in minutes (0 to 10080).').optional(),
        cancelCutoffMin: z.number().int().min(0).max(10080).describe('Free cancellation until this many minutes before the appointment (0 to 10080).').optional(),
      })
      .strict()
      .optional(),
    services: z.array(ServiceIn).max(MAX_SERVICES).optional(),
    staff: z.array(StaffIn).max(MAX_STAFF).optional(),
    hours: z.array(HoursIn).max(MAX_STAFF).optional(),
  })
  .strict();

export type Proposal = z.output<typeof ProposalSchema>;

/** Stable JSON: keys sorted at every level, so the same content always hashes the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export const hashProposal = (p: Proposal): string => createHash('sha256').update(canonical(p)).digest('hex');

/* ---------------------------------- planning against the current state ---------------------------------- */

export interface ExistingSetup {
  business: {
    category: string | null;
    area: string | null;
    address: string | null;
    slotStepMin: number;
    minNoticeMin: number;
    cancelCutoffMin: number;
  };
  services: { id: string; name: string; durationMin: number; price: number; active: boolean }[];
  staff: { id: string; displayName: string; serviceIds: string[]; active: boolean; bookable: boolean }[];
  hours: Record<string, HoursInterval[]>;
  /** For the plan-limit check; omitted = not checked here (the apply still enforces it). */
  plan?: PlanName;
  bookableCount?: number;
}

export type BusinessField = 'category' | 'area' | 'address' | 'slotStepMin' | 'minNoticeMin' | 'cancelCutoffMin';

export interface SetupPlan {
  business: {
    patch: Partial<Record<BusinessField, string | number>>;
    changes: { field: BusinessField; from: string | number | null; to: string | number }[];
  };
  services: {
    create: { name: string; durationMin: number; price: number }[];
    skipped: { name: string; reason: 'exists' }[];
  };
  staff: {
    create: { name: string; serviceNames: string[] }[];
    skipped: { name: string; reason: 'exists' }[];
  };
  hours: { staffName: string; staffId: string | null; before: HoursInterval[]; after: HoursInterval[] }[];
  /** Blocking: the plan must not be stored or applied while any remain. */
  problems: string[];
}

const key = (name: string) => name.normalize('NFC').toLocaleLowerCase('en');

const BUSINESS_FIELDS: BusinessField[] = [
  'category',
  'area',
  'address',
  'slotStepMin',
  'minNoticeMin',
  'cancelCutoffMin',
];

/**
 * Resolve a validated proposal against what the business has now. Existing services and staff (matched by
 * case-insensitive name) are skipped and reported, never duplicated or edited; hours REPLACE the weekly pattern of
 * the named person. Anything that cannot be resolved is a blocking problem. Pure: run at preview AND again inside
 * the apply transaction, so the plan always acts on the live state.
 */
export function planChanges(proposal: Proposal, existing: ExistingSetup): SetupPlan {
  const problems: string[] = [];

  // ---- business fields: only real differences are changes
  const wanted: Partial<Record<BusinessField, string | number>> = {
    ...(proposal.profile ?? {}),
    ...(proposal.settings ?? {}),
  };
  const patch: SetupPlan['business']['patch'] = {};
  const changes: SetupPlan['business']['changes'] = [];
  for (const field of BUSINESS_FIELDS) {
    const to = wanted[field];
    if (to === undefined) continue;
    const from = existing.business[field];
    if (from === to) continue;
    patch[field] = to;
    changes.push({ field, from, to });
  }

  // ---- services
  const existingServices = new Map(existing.services.map((s) => [key(s.name), s]));
  const seenServices = new Set<string>();
  const serviceCreate: SetupPlan['services']['create'] = [];
  const serviceSkipped: SetupPlan['services']['skipped'] = [];
  for (const s of proposal.services ?? []) {
    const k = key(s.name);
    if (seenServices.has(k)) {
      problems.push(`The service "${s.name}" is listed twice.`);
      continue;
    }
    seenServices.add(k);
    if (existingServices.has(k)) serviceSkipped.push({ name: s.name, reason: 'exists' });
    else serviceCreate.push({ name: s.name, durationMin: s.durationMin, price: s.price });
  }
  /** Canonical display name of every service the business will have after this plan. */
  const knownServices = new Map<string, string>([
    ...existing.services.map((s) => [key(s.name), s.name] as const),
    ...serviceCreate.map((s) => [key(s.name), s.name] as const),
  ]);

  // ---- staff
  const existingStaff = new Map(existing.staff.map((s) => [key(s.displayName), s]));
  const seenStaff = new Set<string>();
  const staffCreate: SetupPlan['staff']['create'] = [];
  const staffSkipped: SetupPlan['staff']['skipped'] = [];
  for (const p of proposal.staff ?? []) {
    const k = key(p.name);
    if (seenStaff.has(k)) {
      problems.push(`The person "${p.name}" is listed twice.`);
      continue;
    }
    seenStaff.add(k);
    if (existingStaff.has(k)) {
      staffSkipped.push({ name: p.name, reason: 'exists' });
      continue;
    }
    const serviceNames: string[] = [];
    for (const wantedService of p.services) {
      const known = knownServices.get(key(wantedService));
      if (!known) {
        problems.push(`"${p.name}" is given the service "${wantedService}", which does not exist and is not in this proposal.`);
        continue;
      }
      if (!serviceNames.includes(known)) serviceNames.push(known);
    }
    staffCreate.push({ name: p.name, serviceNames });
  }
  if (existing.plan && existing.bookableCount !== undefined && staffCreate.length > 0) {
    // Every created person is bookable: check one at a time against the plan, like the dashboard would.
    for (let i = 0; i < staffCreate.length; i++) {
      const check = canAddBookableStaff(existing.plan, existing.bookableCount + i);
      if (!check.ok) {
        problems.push(
          `Your plan allows ${check.limit} bookable staff member${check.limit === 1 ? '' : 's'} and ${check.current} ${check.current === 1 ? 'exists' : 'exist'} already. Upgrade the plan in Maw3ed or propose fewer people.`,
        );
        break;
      }
    }
  }

  // ---- hours: replace the weekly pattern of the named person
  const seenHours = new Set<string>();
  const hoursPlan: SetupPlan['hours'] = [];
  for (const h of proposal.hours ?? []) {
    const k = key(h.staff);
    if (seenHours.has(k)) {
      problems.push(`Hours for "${h.staff}" are listed twice.`);
      continue;
    }
    seenHours.add(k);
    const current = existingStaff.get(k);
    const willBeCreated = staffCreate.some((c) => key(c.name) === k);
    if (!current && !willBeCreated) {
      problems.push(`Hours are given for "${h.staff}", who is not on the team and not in this proposal.`);
      continue;
    }
    if (current && !current.active) {
      problems.push(`"${h.staff}" is switched off, so their hours cannot be changed.`);
      continue;
    }
    const after = sortIntervals(mergeWeekIntervals(flattenDays(h.days)));
    hoursPlan.push({
      staffName: current?.displayName ?? h.staff,
      staffId: current?.id ?? null,
      before: current ? sortIntervals(existing.hours[current.id] ?? []) : [],
      after,
    });
  }

  return {
    business: { patch, changes },
    services: { create: serviceCreate, skipped: serviceSkipped },
    staff: { create: staffCreate, skipped: staffSkipped },
    hours: hoursPlan,
    problems,
  };
}

/** True when applying the plan would change nothing. */
export const isEmptyPlan = (p: SetupPlan): boolean =>
  p.business.changes.length === 0 &&
  p.services.create.length === 0 &&
  p.staff.create.length === 0 &&
  p.hours.length === 0;
