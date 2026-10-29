import { requireRole } from '@/server/http/auth';
import { AppError, pgErrorCode } from '@/server/http/errors';
import type { SessionContext } from '@/server/http/withRoute';
import { staffRepo } from '@/server/repositories/staff.repo';
import { timeOffRepo } from '@/server/repositories/timeOff.repo';

interface Deps {
  now: () => Date;
}
const defaultDeps: Deps = { now: () => new Date() };

const MAX_SPAN_MS = 366 * 24 * 60 * 60 * 1000;

type Row = Awaited<ReturnType<typeof timeOffRepo.create>>;
const toDto = (t: Row) => ({
  id: t.id,
  startAt: t.startAt.toISOString(),
  endAt: t.endAt.toISOString(),
  reason: t.reason,
});

export const timeOffService = {
  /** OWNER and STAFF. Future and ongoing only unless includePast. */
  async list(
    ctx: SessionContext,
    staffId: string,
    opts: { includePast?: boolean } = {},
    deps: Deps = defaultDeps,
  ) {
    if (!(await staffRepo.exists(ctx.businessId, staffId))) throw AppError.notFound();
    const rows = await timeOffRepo.list(ctx.businessId, staffId, {
      endingAfter: opts.includePast ? undefined : deps.now(),
    });
    return { items: rows.map(toDto) };
  },

  async create(
    ctx: SessionContext,
    staffId: string,
    input: { startAt: string; endAt: string; reason: 'VACATION' | 'SICK' | 'OTHER' },
  ) {
    requireRole(ctx, 'OWNER');
    if (!(await staffRepo.exists(ctx.businessId, staffId))) throw AppError.notFound();
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);
    if (endAt.getTime() <= startAt.getTime())
      throw AppError.validation({ endAt: 'End must be after start.' });
    if (endAt.getTime() - startAt.getTime() > MAX_SPAN_MS)
      throw AppError.validation({ endAt: 'Time off can span at most one year.' });
    try {
      return toDto(
        await timeOffRepo.create(ctx.businessId, staffId, { startAt, endAt, reason: input.reason }),
      );
    } catch (error) {
      // timeoff_end_after_start CHECK
      if (pgErrorCode(error) === '23514')
        throw AppError.validation({ endAt: 'End must be after start.' });
      throw error;
    }
  },

  async remove(ctx: SessionContext, staffId: string, timeOffId: string) {
    requireRole(ctx, 'OWNER');
    if (!(await timeOffRepo.remove(ctx.businessId, staffId, timeOffId))) throw AppError.notFound();
  },
};
