import { db } from './db';
import { lockStaff } from './staff.repo';

export interface HoursRow {
  weekday: number;
  startLocal: string;
  endLocal: string;
}

export const workingHoursRepo = {
  list: async (businessId: string, staffId: string): Promise<HoursRow[]> => {
    const rows = await db.workingHours.findMany({
      where: { businessId, staffId },
      select: { weekday: true, startLocal: true, endLocal: true },
    });
    return rows;
  },

  /**
   * Lock the staff row, delete every row and insert the new set in one transaction. The lock makes
   * concurrent replaces serialise (without it, two racing PUTs would leave the union of both sets);
   * if any insert fails (for example the end > start CHECK) the previous rows are kept.
   * Throws StaffNotFoundError when the staff member is not in this business.
   */
  replaceAll: (businessId: string, staffId: string, intervals: HoursRow[]) =>
    db.$transaction(async (tx) => {
      await lockStaff(tx, businessId, staffId);
      await tx.workingHours.deleteMany({ where: { staffId, businessId } });
      if (intervals.length > 0)
        await tx.workingHours.createMany({
          data: intervals.map((i) => ({
            businessId,
            staffId,
            weekday: i.weekday,
            startLocal: i.startLocal,
            endLocal: i.endLocal,
          })),
        });
    }),
};
