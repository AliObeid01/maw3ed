import { randomBytes } from 'node:crypto';
import { CATEGORY_KEYS } from '@/lib/business/profile';
import {
  CreateServiceBody,
  CreateStaffBody,
  SetHoursBody,
  UpdateBusinessBody,
} from '@/server/contracts/setup';
import type { HoursInterval } from '@/server/domain/hours';
import {
  hashProposal,
  isEmptyPlan,
  planChanges,
  ProposalSchema,
  type ExistingSetup,
  type Proposal,
  type SetupPlan,
} from '@/server/domain/setupProposal';
import { AppError, zodFields } from '@/server/http/errors';
import type { Logger } from '@/server/http/logger';
import type { SessionContext } from '@/server/http/withRoute';
import { cleanText, quote } from '@/server/mcp/sanitize';
import { billingRepo } from '@/server/repositories/billing.repo';
import { runInTransaction } from '@/server/repositories/unitOfWork';
import { mcpPlanRepo } from '@/server/repositories/mcpPlan.repo';
import { businessService } from './businessService';
import { catalogService } from './catalogService';
import { hoursService } from './hoursService';
import type { OwnerActor } from './oauth';
import { staffService } from './staffService';

/**
 * The owner setup use cases behind the MCP tools `get_setup_status`, `preview_setup_changes` and
 * `apply_setup_changes`. Every change goes through the EXISTING dashboard services (businessService, catalogService,
 * staffService, hoursService): same validation, plan limits and role checks. No Prisma here. The tenant is the
 * actor's business (from the token grant), never an argument. No client or appointment data is read anywhere.
 */
export const PLAN_TTL_MS = 15 * 60_000;

export interface OwnerCallCtx {
  actor: OwnerActor;
  requestId: string;
  logger: Logger;
}

export interface Deps {
  now: () => Date;
}
const defaultDeps: Deps = { now: () => new Date() };

/** The dashboard context for the grant's owner. `sessionId` is a label only (there is no cookie session). */
function sessionCtx(c: OwnerCallCtx): SessionContext {
  return {
    requestId: c.requestId,
    logger: c.logger,
    businessId: c.actor.businessId,
    userId: c.actor.userId,
    role: 'OWNER',
    sessionId: `mcp:${c.actor.grantId}`,
  };
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Mon-Sat 09:00-21:00; Sun closed" (groups consecutive days with identical hours, Monday first). */
export function formatHours(intervals: readonly HoursInterval[]): string {
  if (intervals.length === 0) return 'no hours set';
  const perDay = (d: number) => {
    const list = intervals
      .filter((i) => i.weekday === d)
      .sort((a, b) => a.startLocal.localeCompare(b.startLocal))
      .map((i) => `${i.startLocal}-${i.endLocal}`);
    return list.length ? list.join(', ') : 'closed';
  };
  const order = [1, 2, 3, 4, 5, 6, 0];
  const groups: { from: number; to: number; label: string }[] = [];
  for (const d of order) {
    const label = perDay(d);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.to = d;
    else groups.push({ from: d, to: d, label });
  }
  return groups
    .map((g) => `${g.from === g.to ? DAY[g.from] : `${DAY[g.from]}-${DAY[g.to]}`} ${g.label}`)
    .join('; ');
}

async function loadExisting(ctx: SessionContext): Promise<ExistingSetup & { businessName: string }> {
  const [business, services, staff, plan] = await Promise.all([
    businessService.get(ctx),
    catalogService.list(ctx),
    staffService.list(ctx),
    billingRepo.summary(ctx.businessId),
  ]);
  const hours: Record<string, HoursInterval[]> = {};
  for (const s of staff.staff) hours[s.id] = (await hoursService.get(ctx, s.id)).intervals;
  return {
    businessName: business.name,
    business: {
      category: business.category,
      area: business.area,
      address: business.address,
      slotStepMin: business.slotStepMin,
      minNoticeMin: business.minNoticeMin,
      cancelCutoffMin: business.cancelCutoffMin,
    },
    services: services.services.map((s) => ({
      id: s.id,
      name: s.name,
      durationMin: s.durationMin,
      price: s.price,
      active: s.active,
    })),
    staff: staff.staff.map((s) => ({
      id: s.id,
      displayName: s.displayName,
      serviceIds: s.serviceIds,
      active: s.active,
      bookable: s.bookable,
    })),
    hours,
    ...(plan ? { plan: plan.plan, bookableCount: plan.bookableStaff } : {}),
  };
}

/* ---------------------------------- get_setup_status ---------------------------------- */

export async function getStatus(c: OwnerCallCtx) {
  const ctx = sessionCtx(c);
  const e = await loadExisting(ctx);
  const nameOf = new Map(e.services.map((s) => [s.id, s.name]));
  const staff = e.staff.map((s) => ({
    name: cleanText(s.displayName, 60),
    active: s.active,
    bookable: s.bookable,
    services: s.serviceIds.map((id) => cleanText(nameOf.get(id), 80)).filter(Boolean),
    hours: formatHours(e.hours[s.id] ?? []),
  }));
  const missing: string[] = [];
  if (!e.business.category) missing.push('category');
  if (!e.business.area) missing.push('area');
  if (!e.business.address) missing.push('address');
  if (e.services.filter((s) => s.active).length === 0) missing.push('services');
  if (e.staff.filter((s) => s.active && s.bookable).length === 0) missing.push('staff (no bookable team member yet)');
  for (const s of e.staff.filter((x) => x.active && x.bookable)) {
    if ((e.hours[s.id] ?? []).length === 0) missing.push(`working hours for ${quote(s.displayName, 60)}`);
    if (s.serviceIds.length === 0) missing.push(`services for ${quote(s.displayName, 60)}`);
  }
  return {
    business: {
      name: cleanText(e.businessName, 80),
      category: e.business.category ? cleanText(e.business.category, 40) : null,
      area: e.business.area ? cleanText(e.business.area, 40) : null,
      address: e.business.address ? cleanText(e.business.address, 120) : null,
      slotStepMin: e.business.slotStepMin,
      minNoticeMin: e.business.minNoticeMin,
      cancelCutoffMin: e.business.cancelCutoffMin,
    },
    services: e.services.map((s) => ({
      name: cleanText(s.name, 80),
      durationMin: s.durationMin,
      price: s.price,
      active: s.active,
    })),
    staff,
    missing,
    categoryChoices: [...CATEGORY_KEYS],
  };
}

/* ---------------------------------- preview ---------------------------------- */

const priceText = (n: number) => `${n}`;

function describe(plan: SetupPlan): string[] {
  const lines: string[] = [];
  for (const ch of plan.business.changes)
    lines.push(
      `Change ${ch.field}. Now: ${ch.from === null ? 'not set' : typeof ch.from === 'string' ? quote(ch.from) : ch.from}. New: ${typeof ch.to === 'string' ? quote(ch.to) : ch.to}`,
    );
  for (const s of plan.services.create)
    lines.push(`Add service ${quote(s.name)}: ${s.durationMin} min, price ${priceText(s.price)}`);
  for (const s of plan.services.skipped) lines.push(`Skip service ${quote(s.name)} (already exists, not changed)`);
  for (const p of plan.staff.create)
    lines.push(`Add team member ${quote(p.name, 60)}${p.serviceNames.length ? ` offering ${p.serviceNames.map((n) => quote(n)).join(', ')}` : ''}`);
  for (const p of plan.staff.skipped) lines.push(`Skip team member ${quote(p.name, 60)} (already exists, not changed)`);
  for (const h of plan.hours)
    lines.push(`Replace weekly hours of ${quote(h.staffName, 60)}. Now: ${formatHours(h.before)}. New: ${formatHours(h.after)}`);
  return lines;
}

function counts(plan: SetupPlan) {
  return {
    businessChanges: plan.business.changes.length,
    servicesAdded: plan.services.create.length,
    servicesSkipped: plan.services.skipped.length,
    staffAdded: plan.staff.create.length,
    staffSkipped: plan.staff.skipped.length,
    hoursReplaced: plan.hours.length,
  };
}

export async function preview(c: OwnerCallCtx, rawProposal: unknown, deps: Deps = defaultDeps) {
  const now = deps.now();
  const ctx = sessionCtx(c);
  const parsed = ProposalSchema.safeParse(rawProposal);
  if (!parsed.success) {
    await audit(c, 'preview_setup_changes', {}, 'invalid');
    throw AppError.validation(zodFields(parsed.error), 'The proposal is not valid.');
  }
  const proposal = parsed.data;
  const plan = planChanges(proposal, await loadExisting(ctx));
  if (plan.problems.length > 0) {
    await audit(c, 'preview_setup_changes', counts(plan), 'blocked');
    throw AppError.validation(
      Object.fromEntries(plan.problems.map((p, i) => [`problem${i + 1}`, p])),
      `This cannot be applied: ${plan.problems.join(' ')}`,
    );
  }
  const planId = `plan_${randomBytes(18).toString('base64url')}`;
  const expiresAt = new Date(now.getTime() + PLAN_TTL_MS);
  await mcpPlanRepo.create(c.actor.businessId, c.actor.grantId, {
    id: planId,
    proposalJson: proposal,
    proposalHash: hashProposal(proposal),
    expiresAt,
  });
  await audit(c, 'preview_setup_changes', counts(plan), 'ok');
  const lines = describe(plan);
  return {
    planId,
    expiresAt: expiresAt.toISOString(),
    empty: isEmptyPlan(plan),
    lines,
    counts: counts(plan),
    note: 'Nothing has been saved yet. Show these changes to the owner and call apply_setup_changes with this planId only after they explicitly agree.',
  };
}

/* ---------------------------------- apply ---------------------------------- */

export interface ApplyResult {
  created: { services: string[]; staff: string[] };
  changed: { business: { field: string; from: string | number | null; to: string | number }[]; hours: { staff: string; hours: string }[] };
  skipped: { services: string[]; staff: string[] };
}

export async function apply(c: OwnerCallCtx, planId: string, deps: Deps = defaultDeps) {
  const now = deps.now();
  const ctx = sessionCtx(c);
  const { businessId, grantId } = c.actor;
  try {
    const result = await runInTransaction(async (): Promise<ApplyResult | null> => {
      const claimed = await mcpPlanRepo.claim(businessId, grantId, planId, now);
      if (!claimed) return null;
      const stored = ProposalSchema.safeParse(claimed.proposalJson);
      // The stored plan must still be exactly what was previewed (the hash is over the validated proposal).
      if (!stored.success || hashProposal(stored.data) !== claimed.proposalHash)
        throw new AppError(409, 'PLAN_INVALID', 'This plan was changed after it was previewed. Preview it again.');
      const out = await execute(ctx, stored.data);
      await mcpPlanRepo.saveResult(businessId, planId, out);
      return out;
    });
    if (result) {
      await audit(c, 'apply_setup_changes', resultCounts(result), 'ok');
      return { alreadyApplied: false as const, result };
    }
  } catch (error) {
    await audit(c, 'apply_setup_changes', {}, error instanceof AppError ? error.code : 'error');
    throw error;
  }
  // Not claimed: applied before (idempotent retry), expired, or not this grant's plan.
  const existing = await mcpPlanRepo.find(businessId, grantId, planId);
  if (!existing) {
    await audit(c, 'apply_setup_changes', {}, 'not_found');
    throw new AppError(404, 'PLAN_NOT_FOUND', 'No such plan for this connection. Preview the changes again.');
  }
  if (existing.appliedAt && existing.resultJson) {
    await audit(c, 'apply_setup_changes', {}, 'already_applied');
    return { alreadyApplied: true as const, result: existing.resultJson as ApplyResult };
  }
  await audit(c, 'apply_setup_changes', {}, 'expired');
  throw new AppError(410, 'PLAN_EXPIRED', 'This plan expired (plans last 15 minutes). Preview the changes again.');
}

const resultCounts = (r: ApplyResult) => ({
  servicesAdded: r.created.services.length,
  staffAdded: r.created.staff.length,
  businessChanges: r.changed.business.length,
  hoursReplaced: r.changed.hours.length,
  servicesSkipped: r.skipped.services.length,
  staffSkipped: r.skipped.staff.length,
});

/** Run the plan through the dashboard services, inside the caller's transaction. Re-plans against the live state. */
async function execute(ctx: SessionContext, proposal: Proposal): Promise<ApplyResult> {
  const existing = await loadExisting(ctx);
  const plan = planChanges(proposal, existing);
  if (plan.problems.length > 0)
    throw AppError.conflict(
      'PLAN_STALE',
      { problems: plan.problems },
      `Your setup changed since the preview and this plan no longer fits: ${plan.problems.join(' ')} Preview it again.`,
    );

  if (plan.business.changes.length > 0) {
    // The same schema the dashboard route uses, restricted to the six fields the owner allowed.
    const body = UpdateBusinessBody.pick({
      category: true,
      area: true,
      address: true,
      slotStepMin: true,
      minNoticeMin: true,
      cancelCutoffMin: true,
    }).parse(plan.business.patch);
    await businessService.update(ctx, body);
  }

  const key = (n: string) => n.normalize('NFC').toLocaleLowerCase('en');
  const serviceIds = new Map(existing.services.map((s) => [key(s.name), s.id]));
  for (const s of plan.services.create) {
    const body = CreateServiceBody.parse({ name: s.name, durationMin: s.durationMin, price: s.price });
    const created = await catalogService.create(ctx, body);
    serviceIds.set(key(s.name), created.id);
  }

  const staffIds = new Map(existing.staff.map((s) => [key(s.displayName), s.id]));
  for (const p of plan.staff.create) {
    const body = CreateStaffBody.parse({
      displayName: p.name,
      bookable: true,
      serviceIds: p.serviceNames.map((n) => serviceIds.get(key(n))).filter((x): x is string => !!x),
    });
    const created = await staffService.create(ctx, body);
    staffIds.set(key(p.name), created.id);
  }

  for (const h of plan.hours) {
    const id = h.staffId ?? staffIds.get(key(h.staffName));
    if (!id) throw AppError.notFound();
    await hoursService.replace(ctx, id, SetHoursBody.parse({ intervals: h.after }));
  }

  return {
    created: {
      services: plan.services.create.map((s) => cleanText(s.name, 80)),
      staff: plan.staff.create.map((p) => cleanText(p.name, 60)),
    },
    changed: {
      business: plan.business.changes,
      hours: plan.hours.map((h) => ({ staff: cleanText(h.staffName, 60), hours: formatHours(h.after) })),
    },
    skipped: {
      services: plan.services.skipped.map((s) => cleanText(s.name, 80)),
      staff: plan.staff.skipped.map((s) => cleanText(s.name, 60)),
    },
  };
}

async function audit(
  c: OwnerCallCtx,
  tool: string,
  summary: Record<string, number>,
  outcome: string,
): Promise<void> {
  // Best effort: a failing audit row must never turn a committed apply into an error (a retry would say 'already applied').
  await mcpPlanRepo
    .record(c.actor.businessId, c.actor.grantId, { tool, summary, outcome })
    .catch((error) => c.logger.error({ tool, err: { name: (error as Error)?.name } }, 'mcp audit write failed'));
}
