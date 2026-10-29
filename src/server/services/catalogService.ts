import type { ServiceDtoT } from '@/server/contracts/setup';
import { requireRole } from '@/server/http/auth';
import { AppError } from '@/server/http/errors';
import type { SessionContext } from '@/server/http/withRoute';
import { serviceRepo, type ServiceFields } from '@/server/repositories/service.repo';

type Row = NonNullable<Awaited<ReturnType<typeof serviceRepo.findById>>>;

export const toServiceDto = (s: Row): ServiceDtoT => ({
  id: s.id,
  name: s.name,
  durationMin: s.durationMin,
  bufferMin: s.bufferMin,
  price: Number(s.price),
  active: s.active,
  sortOrder: s.sortOrder,
});

export const catalogService = {
  /** OWNER and STAFF. Returns every service (active flag included) unless active-only is asked for. */
  async list(ctx: SessionContext, opts: { includeInactive?: boolean } = {}) {
    // Default is ALL services (the setup screens need inactive ones); includeInactive=0 narrows to active.
    const activeOnly = opts.includeInactive === false;
    const rows = await serviceRepo.list(ctx.businessId, { activeOnly });
    return { services: rows.map(toServiceDto) };
  },

  async create(
    ctx: SessionContext,
    input: Pick<ServiceFields, 'name' | 'durationMin' | 'bufferMin' | 'price'>,
  ) {
    requireRole(ctx, 'OWNER');
    return toServiceDto(await serviceRepo.create(ctx.businessId, input));
  },

  async update(ctx: SessionContext, id: string, patch: Partial<ServiceFields>) {
    requireRole(ctx, 'OWNER');
    if (Object.keys(patch).length > 0 && !(await serviceRepo.update(ctx.businessId, id, patch)))
      throw AppError.notFound();
    const row = await serviceRepo.findById(ctx.businessId, id);
    if (!row) throw AppError.notFound();
    return toServiceDto(row);
  },
};
