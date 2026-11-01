import { db } from './db';
import { lockUserPasswordHash } from './user.repo';

export const sessionRepo = {
  create: (businessId: string, data: { userId: string; tokenHash: string; expiresAt: Date }) =>
    db.session.create({ data: { businessId, ...data } }),
  /**
   * Insert a session for a user whose password was checked OUTSIDE this transaction. The User row is locked
   * first (see lockUserPasswordHash for the lock order) and the hash read under the lock must still be the one
   * that was verified; otherwise a reset/change-password committed in between and NO session is created (false).
   */
  createIfPasswordUnchanged: (
    businessId: string,
    data: { userId: string; tokenHash: string; expiresAt: Date; verifiedPasswordHash: string },
  ): Promise<boolean> =>
    db.$transaction(async (tx) => {
      const current = await lockUserPasswordHash(tx, data.userId);
      if (!current || current !== data.verifiedPasswordHash) return false;
      await tx.session.create({
        data: {
          businessId,
          userId: data.userId,
          tokenHash: data.tokenHash,
          expiresAt: data.expiresAt,
        },
      });
      return true;
    }),
  /** Entry point of session auth: the businessId is not known until the session is found. */
  findByTokenHash: (tokenHash: string) => db.session.findUnique({ where: { tokenHash } }),
  async touch(businessId: string, id: string, lastSeenAt: Date, expiresAt: Date) {
    await db.session.updateMany({ where: { id, businessId }, data: { lastSeenAt, expiresAt } });
  },
  async deleteById(businessId: string, id: string) {
    await db.session.deleteMany({ where: { id, businessId } });
  },
  /**
   * Maintenance (all tenants, cron only): delete up to `limit` sessions that are past their sliding expiry
   * or older than the absolute lifetime. Returns how many were deleted.
   */
  async deleteDead(now: Date, absoluteCutoff: Date, limit: number): Promise<number> {
    const rows = await db.session.findMany({
      where: { OR: [{ expiresAt: { lte: now } }, { createdAt: { lte: absoluteCutoff } }] },
      select: { id: true },
      take: limit,
    });
    if (!rows.length) return 0;
    const { count } = await db.session.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    return count;
  },
};
