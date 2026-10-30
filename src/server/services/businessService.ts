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
    listed: b.listed,
    deposit: {
      enabled: b.depositEnabled,
      threshold: b.depositThreshold,
      amount: Number(b.depositAmount.toString()),
      currency: b.currency,
    },
    readiness: {
      services: setup.hasServices,
      staff: setup.hasBookableStaff,
      hours: setup.hasHours,
    },
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
      'listed',
      'depositEnabled',
      'depositThreshold',
      'depositAmount',
    ] as const) {
      if (patch[key] !== undefined) Object.assign(data, { [key]: patch[key] });
    }
    // Going public needs a bookable business. Checked before anything is written; turning off is always allowed.
    if (data.listed === true) {
      const setup = await businessRepo.setupFlags(ctx.businessId);
      const missing = [
        ...(setup.hasServices ? [] : ['services']),
        ...(setup.hasBookableStaff ? [] : ['staff']),
        ...(setup.hasHours ? [] : ['hours']),
      ];
      if (missing.length > 0)
        throw AppError.conflict(
          'NOT_READY',
          { missing },
          'Add a service, a bookable team member and working hours before listing.',
        );
    }
    if (Object.keys(data).length > 0 && !(await businessRepo.update(ctx.businessId, data)))
      throw AppError.notFound();
    return load(ctx);
  },
};
