import { db } from './db';

export interface BusinessPatch {
  name?: string;
  timezone?: string;
  slotStepMin?: number;
  bookingWindowDays?: number;
  minNoticeMin?: number;
  cancelCutoffMin?: number;
  category?: string | null;
  address?: string | null;
  listed?: boolean;
}

export const businessRepo = {
  slugExists: async (slug: string) =>
    (await db.business.findUnique({ where: { slug }, select: { id: true } })) !== null,
  /** The id comes from the session, so this IS the tenant boundary. */
  findById: (businessId: string) => db.business.findUnique({ where: { id: businessId } }),

  /** Only the whitelisted settings columns; slug and plan are never written here. */
  update: async (businessId: string, patch: BusinessPatch) => {
    const result = await db.business.updateMany({ where: { id: businessId }, data: patch });
    return result.count === 1;
  },

  /** Setup progress: active services, active bookable staff, and whether any of them has hours. */
  setupFlags: async (businessId: string) => {
    const [services, bookable, withHours] = await Promise.all([
      db.service.count({ where: { businessId, active: true } }),
      db.staffMember.count({ where: { businessId, active: true, bookable: true } }),
      db.staffMember.count({
        where: { businessId, active: true, bookable: true, workingHours: { some: { businessId } } },
      }),
    ]);
    return {
      hasServices: services > 0,
      hasBookableStaff: bookable > 0,
      hasHours: withHours > 0,
    };
  },
};
