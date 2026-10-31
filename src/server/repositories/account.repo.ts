import { db } from './db';

export interface NewBusinessInput {
  business: { slug: string; name: string; timezone: string };
  owner: { name: string; email: string; passwordHash: string };
  sessionTokenHash: string;
  sessionExpiresAt: Date;
}

export const accountRepo = {
  /**
   * Signed-in password change: new hash, every OTHER session of the user deleted (the current one stays) and
   * any open reset link invalidated, in one transaction.
   */
  changePassword: (input: { userId: string; passwordHash: string; keepSessionId: string }) =>
    db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: input.userId }, data: { passwordHash: input.passwordHash } });
      await tx.session.deleteMany({
        where: { userId: input.userId, id: { not: input.keepSessionId } },
      });
      await tx.emailToken.deleteMany({
        where: { userId: input.userId, kind: 'RESET', usedAt: null },
      });
    }),

  /** Delete every session of the user (all businesses) except the current one. Returns how many. */
  async deleteOtherSessions(userId: string, keepSessionId: string): Promise<number> {
    const { count } = await db.session.deleteMany({
      where: { userId, id: { not: keepSessionId } },
    });
    return count;
  },

  /** Business, owner User, OWNER Membership, bookable owner StaffMember and Session in ONE transaction. */
  createBusinessWithOwner: (input: NewBusinessInput) =>
    db.$transaction(async (tx) => {
      const business = await tx.business.create({ data: input.business });
      const user = await tx.user.create({ data: input.owner });
      await tx.membership.create({
        data: { businessId: business.id, userId: user.id, role: 'OWNER' },
      });
      await tx.staffMember.create({
        data: {
          businessId: business.id,
          userId: user.id,
          displayName: input.owner.name,
          bookable: true,
        },
      });
      await tx.session.create({
        data: {
          businessId: business.id,
          userId: user.id,
          tokenHash: input.sessionTokenHash,
          expiresAt: input.sessionExpiresAt,
        },
      });
      return { business, user };
    }),
};
