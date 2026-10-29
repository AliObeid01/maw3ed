import { requireRole } from '@/server/http/auth';
import { AppError } from '@/server/http/errors';
import type { SessionContext } from '@/server/http/withRoute';
import { serviceRepo } from '@/server/repositories/service.repo';
import { staffRepo } from '@/server/repositories/staff.repo';

interface Deps {
  now: () => Date;
}
const defaultDeps: Deps = { now: () => new Date() };

/** Distinct ids, all of which must be services of this business, else 400 (nothing is linked). */
async function ownedServiceIds(ctx: SessionContext, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length > 0 && (await serviceRepo.countOwned(ctx.businessId, unique)) !== unique.length)
    throw AppError.validation({ serviceIds: 'One or more services do not exist.' });
  return unique;
}

async function mustFind(ctx: SessionContext, id: string) {
  const row = await staffRepo.findById(ctx.businessId, id);
  if (!row) throw AppError.notFound();
  return row;
}

export const staffService = {
  /** OWNER and STAFF. */
  async list(ctx: SessionContext) {
    return { staff: await staffRepo.list(ctx.businessId) };
  },

  async create(
    ctx: SessionContext,
    input: { displayName: string; bookable: boolean; serviceIds: string[] },
  ) {
    requireRole(ctx, 'OWNER');
    const serviceIds = await ownedServiceIds(ctx, input.serviceIds);
    const id = await staffRepo.create(ctx.businessId, { ...input, serviceIds });
    return mustFind(ctx, id);
  },

  async update(
    ctx: SessionContext,
    id: string,
    patch: { displayName?: string; bookable?: boolean; active?: boolean },
    deps: Deps = defaultDeps,
  ) {
    requireRole(ctx, 'OWNER');
    const current = await mustFind(ctx, id);
    if (
      patch.active === false &&
      current.active &&
      (await staffRepo.hasFutureActiveAppointments(ctx.businessId, id, deps.now()))
    )
      throw AppError.conflict(
        'HAS_FUTURE_APPOINTMENTS',
        undefined,
        'This person has upcoming appointments. Move or cancel them first.',
      );
    if (Object.keys(patch).length > 0 && !(await staffRepo.update(ctx.businessId, id, patch)))
      throw AppError.notFound();
    return mustFind(ctx, id);
  },

  async setServices(ctx: SessionContext, id: string, input: { serviceIds: string[] }) {
    requireRole(ctx, 'OWNER');
    await mustFind(ctx, id);
    const serviceIds = await ownedServiceIds(ctx, input.serviceIds);
    if (!(await staffRepo.replaceServices(ctx.businessId, id, serviceIds)))
      throw AppError.notFound();
    return { serviceIds: [...serviceIds].sort() };
  },
};
