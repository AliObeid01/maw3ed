import { db } from './db';

export const membershipRepo = {
  findRole: (businessId: string, userId: string) =>
    db.membership.findUnique({
      where: { userId_businessId: { userId, businessId } },
      select: { role: true },
    }),
  /** Login picks the most recently created membership. Not tenant-scoped: it decides which tenant. */
  findLatestForUser: (userId: string) =>
    db.membership.findFirst({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { business: true },
    }),
  hasMembership: async (businessId: string, userId: string) =>
    (await db.membership.count({ where: { businessId, userId } })) > 0,
  /** Is this email already a member of the business? */
  hasMemberWithEmail: async (businessId: string, email: string) =>
    (await db.membership.count({ where: { businessId, user: { email } } })) > 0,
};
