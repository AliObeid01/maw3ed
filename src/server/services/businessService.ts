import type { BusinessDtoT } from '@/server/contracts/setup';
import { requireRole } from '@/server/http/auth';
import { AppError } from '@/server/http/errors';
import type { SessionContext } from '@/server/http/withRoute';
import { businessRepo, type BusinessPatch } from '@/server/repositories/business.repo';

async function load(ctx: SessionContext): Promise<BusinessDtoT> {
  const [b, setup] = await Promise.all([
    businessRepo.findById(ctx.businessId),
    businessRepo.setupFlags(ctx.businessId),
  ]);
  if (!b) throw AppError.notFound();
  return {
    id: b.id,
    slug: b.slug,
    name: b.name,
    timezone: b.timezone,
    locale: b.locale,
    slotStepMin: b.slotStepMin,
    bookingWindowDays: b.bookingWindowDays,
    minNoticeMin: b.minNoticeMin,
    cancelCutoffMin: b.cancelCutoffMin,
    category: b.category,
    address: b.address,
    setup,
  };
}

export const businessService = {
  /** OWNER and STAFF. */
  get: (ctx: SessionContext) => load(ctx),

  async update(ctx: SessionContext, patch: BusinessPatch) {
    requireRole(ctx, 'OWNER');
    // Whitelist again here: even if a caller widened the schema, slug and plan never reach the repo.
    const data: BusinessPatch = {};
    for (const key of [
      'name',
      'timezone',
      'slotStepMin',
      'bookingWindowDays',
      'minNoticeMin',
      'cancelCutoffMin',
      'category',
      'address',
    ] as const) {
      if (patch[key] !== undefined) Object.assign(data, { [key]: patch[key] });
    }
    if (Object.keys(data).length > 0 && !(await businessRepo.update(ctx.businessId, data)))
      throw AppError.notFound();
    return load(ctx);
  },
};
