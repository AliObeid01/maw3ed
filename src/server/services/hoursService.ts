import { mergeWeekIntervals } from '@/lib/setup/hoursMerge';
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
    // Validated (no overlap), so only touching blocks remain to join: the slot engine fits a booking inside ONE block.
    const intervals = sortIntervals(mergeWeekIntervals(input.intervals));
    await workingHoursRepo.replaceAll(ctx.businessId, staffId, intervals).catch((error) => {
      if (error instanceof StaffNotFoundError) throw AppError.notFound();
      throw error;
    });
    return { intervals };
  },

  /**
   * OWNER only. Replace the weekly hours of each target with the source's (merged), in one transaction. Time off and
   * services stay. Any id outside this business (source or target) is 404; the source as a target, or a repeated id,
   * is 400.
   */
  async copyTo(ctx: SessionContext, sourceId: string, targetStaffIds: string[]) {
    requireRole(ctx, 'OWNER');
    if (!(await staffRepo.exists(ctx.businessId, sourceId))) throw AppError.notFound();
    if (targetStaffIds.includes(sourceId))
      throw AppError.validation({
        targetStaffIds: 'Pick other staff members, not the one you copy from.',
      });
    if (new Set(targetStaffIds).size !== targetStaffIds.length)
      throw AppError.validation({ targetStaffIds: 'Each staff member can be listed once.' });
    const staff = await workingHoursRepo
      .copyToMany(ctx.businessId, sourceId, targetStaffIds, (rows) =>
        sortIntervals(mergeWeekIntervals(rows)),
      )
      .catch((error) => {
        if (error instanceof StaffNotFoundError) throw AppError.notFound();
        throw error;
      });
    return { staff };
  },
};
