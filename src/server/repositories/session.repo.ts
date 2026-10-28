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
};
