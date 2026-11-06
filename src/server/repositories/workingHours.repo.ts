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

  /**
   * Copy the source's weekly hours onto every target in ONE transaction (all or nothing). Locks the source and the
   * targets in id order (no deadlock between two copies), reads the source inside the lock, maps it through
   * `normalise` (the hours merge) and replaces each target's rows. Time off and services are not touched.
   * Source rows with end <= start are skipped. Throws StaffNotFoundError when any id is not in this business. Returns the new rows per target, in input order.
   */
  copyToMany: (
    businessId: string,
    sourceId: string,
    targetIds: string[],
    normalise: (rows: HoursRow[]) => HoursRow[],
  ) =>
    db.$transaction(async (tx) => {
      for (const id of [...new Set([sourceId, ...targetIds])].sort())
        await lockStaff(tx, businessId, id);
      // Legacy rows whose end is not after the start (from before the CHECK) would fail the insert on the targets
      // and turn the whole copy into a 500: they are skipped, the valid rows are copied. ("HH:mm" compares as text.)
      const stored = await tx.workingHours.findMany({
        where: { businessId, staffId: sourceId },
        select: { weekday: true, startLocal: true, endLocal: true },
      });
      const source = normalise(stored.filter((r) => r.endLocal > r.startLocal));
      await tx.workingHours.deleteMany({ where: { businessId, staffId: { in: targetIds } } });
      if (source.length > 0)
        await tx.workingHours.createMany({
          data: targetIds.flatMap((staffId) =>
            source.map((i) => ({
              businessId,
              staffId,
              weekday: i.weekday,
              startLocal: i.startLocal,
              endLocal: i.endLocal,
            })),
          ),
        });
      return targetIds.map((staffId) => ({ staffId, intervals: source }));
    }),
};
