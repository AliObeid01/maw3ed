import { db } from './db';

export interface NewBusinessInput {
  business: { slug: string; name: string; timezone: string };
  owner: { name: string; email: string; passwordHash: string };
  sessionTokenHash: string;
  sessionExpiresAt: Date;
}

export const accountRepo = {
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
