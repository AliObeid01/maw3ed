import { db } from './db';

export interface BusinessPatch {
  name?: string;
  timezone?: string;
  slotStepMin?: number;
  bookingWindowDays?: number;
  minNoticeMin?: number;
  cancelCutoffMin?: number;
  category?: string | null;
  area?: string | null;
  address?: string | null;
  listed?: boolean;
  depositEnabled?: boolean;
  depositThreshold?: number;
  depositAmount?: number;
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

  /**
   * Update after a check that must see the row as it is when it is written. One transaction: the business row is
   * locked `FOR UPDATE`, read, handed to `guard` (which throws to refuse; the transaction rolls back and the error
   * propagates), then written. A concurrent write to the same row (even a plain UPDATE) queues behind the lock or
   * ahead of it, so the guard never decides on stale data.
   */
  updateGuarded: (
    businessId: string,
    patch: BusinessPatch,
    guard: (current: { listed: boolean; category: string | null; area: string | null }) => void,
  ) =>
    db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Business" WHERE "id" = ${businessId} FOR UPDATE`;
      if (locked.length === 0) return false;
      const current = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { listed: true, category: true, area: true },
      });
      guard(current);
      const result = await tx.business.updateMany({ where: { id: businessId }, data: patch });
      return result.count === 1;
    }),

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
