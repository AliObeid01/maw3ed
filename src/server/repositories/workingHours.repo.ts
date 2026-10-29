import { db } from './db';

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
   * Delete every row and insert the new set in one transaction: if any insert fails (for example the
   * end > start CHECK) the previous rows are kept. Returns false when the staff member is not in this business.
   */
  replaceAll: (businessId: string, staffId: string, intervals: HoursRow[]) =>
    db.$transaction(async (tx) => {
      if ((await tx.staffMember.count({ where: { id: staffId, businessId } })) !== 1) return false;
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
      return true;
    }),
};
