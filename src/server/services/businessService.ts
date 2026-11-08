import type { BusinessDtoT } from '@/server/contracts/setup';
import { profileMissing } from '@/lib/business/profile';
import { requireRole } from '@/server/http/auth';
import { AppError } from '@/server/http/errors';
import type { SessionContext } from '@/server/http/withRoute';
import { businessRepo, type BusinessPatch } from '@/server/repositories/business.repo';
import { businessLogoRepo } from '@/server/repositories/businessLogo.repo';
import { logoUrlFor } from '@/lib/business/logoUrl';
import { emailVerificationService } from './emailVerification';

async function load(ctx: SessionContext): Promise<BusinessDtoT> {
  const [b, setup, logoHash] = await Promise.all([
    businessRepo.findById(ctx.businessId),
    businessRepo.setupFlags(ctx.businessId),
    businessLogoRepo.hashFor(ctx.businessId),
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
    area: b.area,
    address: b.address,
    logoUrl: logoUrlFor(b.slug, logoHash),
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
      'area',
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
      // Soft verification: going public needs a confirmed owner address (unlisting is always allowed).
      await emailVerificationService.assertVerified(ctx.userId);
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
      // PR-1: a listing needs a category and an area. A business that is already listed is grandfathered,
      // and the same request may set them. Checked and written in ONE transaction with the business row locked
      // (updateGuarded), so a concurrent change to category / area cannot slip in between check and write.
      if (
        !(await businessRepo.updateGuarded(ctx.businessId, data, (current) => {
          if (current.listed) return;
          const missingProfile = profileMissing({
            category: data.category !== undefined ? data.category : current.category,
            area: data.area !== undefined ? data.area : current.area,
          });
          if (missingProfile.length > 0)
            throw AppError.validation(
              Object.fromEntries(
                missingProfile.map((f) => [
                  f,
                  f === 'category'
                    ? 'Choose a category before listing in the directory.'
                    : 'Choose an area before listing in the directory.',
                ]),
              ),
              'Choose a category and an area before listing in the directory.',
            );
        }))
      )
        throw AppError.notFound();
      return load(ctx);
    }
    if (Object.keys(data).length > 0 && !(await businessRepo.update(ctx.businessId, data)))
      throw AppError.notFound();
    return load(ctx);
  },
};
