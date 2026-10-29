import { db } from './db';

export const sessionRepo = {
  create: (businessId: string, data: { userId: string; tokenHash: string; expiresAt: Date }) =>
    db.session.create({ data: { businessId, ...data } }),
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
