import { requireRole } from '@/server/http/auth';
import { AppError } from '@/server/http/errors';
import type { SessionContext } from '@/server/http/withRoute';
import { PlanLimitError } from '@/server/repositories/billing.repo';
import {
  HasFutureAppointmentsError,
  ServiceNotOwnedError,
  StaffNotFoundError,
  staffRepo,
} from '@/server/repositories/staff.repo';

interface Deps {
  now: () => Date;
}
const defaultDeps: Deps = { now: () => new Date() };

const badServices = () => AppError.validation({ serviceIds: 'One or more services do not exist.' });

/** 409 PLAN_LIMIT with the numbers (also shared with billing). */
export const planLimit = (e: PlanLimitError) =>
  AppError.conflict(
    'PLAN_LIMIT',
    { limit: e.limit, current: e.current },
    'Your plan allows fewer bookable staff. Upgrade to add more.',
  );

/** Map repository signals to HTTP-shaped errors. */
function mapRepoError(error: unknown): never {
  if (error instanceof StaffNotFoundError) throw AppError.notFound();
  if (error instanceof ServiceNotOwnedError) throw badServices();
  if (error instanceof PlanLimitError) throw planLimit(error);
  if (error instanceof HasFutureAppointmentsError)
    throw AppError.conflict(
      'HAS_FUTURE_APPOINTMENTS',
      undefined,
      'This person has upcoming appointments. Move or cancel them first.',
    );
  throw error;
}

/** The login phone is the owner's business only: a receptionist sees the state, not the number. */
function view<T extends { loginPhone: string | null }>(ctx: SessionContext, row: T): T {
  return ctx.role === 'OWNER' ? row : { ...row, loginPhone: null };
}

async function mustFind(ctx: SessionContext, id: string) {
  const row = await staffRepo.findById(ctx.businessId, id);
  if (!row) throw AppError.notFound();
  return view(ctx, row);
}

export const staffService = {
  /** OWNER and STAFF. */
  async list(ctx: SessionContext) {
    return { staff: (await staffRepo.list(ctx.businessId)).map((r) => view(ctx, r)) };
  },

  async create(
    ctx: SessionContext,
    input: { displayName: string; bookable: boolean; serviceIds: string[] },
  ) {
    requireRole(ctx, 'OWNER');
    const id = await staffRepo.create(ctx.businessId, input).catch(mapRepoError);
    return mustFind(ctx, id);
  },

  async update(
    ctx: SessionContext,
    id: string,
    patch: { displayName?: string; bookable?: boolean; active?: boolean },
    deps: Deps = defaultDeps,
  ) {
    requireRole(ctx, 'OWNER');
    await staffRepo.update(ctx.businessId, id, patch, deps.now()).catch(mapRepoError);
    return mustFind(ctx, id);
  },

  async setServices(ctx: SessionContext, id: string, input: { serviceIds: string[] }) {
    requireRole(ctx, 'OWNER');
    await staffRepo.replaceServices(ctx.businessId, id, input.serviceIds).catch(mapRepoError);
    return { serviceIds: [...new Set(input.serviceIds)].sort() };
  },
};
