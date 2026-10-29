import { findHoursProblem, sortIntervals, type HoursInterval } from '@/server/domain/hours';
import { requireRole } from '@/server/http/auth';
import { AppError } from '@/server/http/errors';
import type { SessionContext } from '@/server/http/withRoute';
import { StaffNotFoundError, staffRepo } from '@/server/repositories/staff.repo';
import { workingHoursRepo } from '@/server/repositories/workingHours.repo';

export const hoursService = {
  /** OWNER and STAFF. */
  async get(ctx: SessionContext, staffId: string) {
    if (!(await staffRepo.exists(ctx.businessId, staffId))) throw AppError.notFound();
    return { intervals: sortIntervals(await workingHoursRepo.list(ctx.businessId, staffId)) };
  },

  async replace(ctx: SessionContext, staffId: string, input: { intervals: HoursInterval[] }) {
    requireRole(ctx, 'OWNER');
    if (!(await staffRepo.exists(ctx.businessId, staffId))) throw AppError.notFound();
    const problem = findHoursProblem(input.intervals);
    if (problem)
      throw AppError.validation({
        intervals: `Interval ${problem.index}: ${problem.message}`,
        [`intervals.${problem.index}`]: problem.message,
      });
    const intervals = sortIntervals(input.intervals);
    await workingHoursRepo.replaceAll(ctx.businessId, staffId, intervals).catch((error) => {
      if (error instanceof StaffNotFoundError) throw AppError.notFound();
      throw error;
    });
    return { intervals };
  },
};
