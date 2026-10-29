import type { TimeOffReason } from '@/generated/prisma/client';
import { db } from './db';

export const timeOffRepo = {
  list: (businessId: string, staffId: string, opts: { endingAfter?: Date } = {}) =>
    db.timeOff.findMany({
      where: {
        businessId,
        staffId,
        ...(opts.endingAfter ? { endAt: { gt: opts.endingAfter } } : {}),
      },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    }),

  create: (
    businessId: string,
    staffId: string,
    data: { startAt: Date; endAt: Date; reason: TimeOffReason },
  ) => db.timeOff.create({ data: { businessId, staffId, ...data } }),

  /** True when exactly one row of this business and staff member was deleted. */
  remove: async (businessId: string, staffId: string, id: string) => {
    const result = await db.timeOff.deleteMany({ where: { id, businessId, staffId } });
    return result.count === 1;
  },
};
