import type { Role } from '@/generated/prisma/client';
import { db } from './db';

/** The user has no membership in this business (also: it belongs to another business, or was removed). */
export class MemberNotFoundError extends Error {}

export interface TeamMemberRow {
  userId: string;
  name: string;
  email: string;
  role: Role;
  emailVerified: boolean;
}

export const membershipRepo = {
  /** Everyone with access to the business, oldest membership first. No password hash, no session data. */
  async listTeam(businessId: string): Promise<TeamMemberRow[]> {
    const rows = await db.membership.findMany({
      where: { businessId },
      select: {
        role: true,
        user: { select: { id: true, name: true, email: true, emailVerifiedAt: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => ({
      userId: r.user.id,
      name: r.user.name,
      email: r.user.email,
      role: r.role,
      emailVerified: r.user.emailVerifiedAt !== null,
    }));
  },

  /**
   * Remove one user's access to ONE business, atomically: their Sessions for this business, the Membership,
   * the login link on their StaffMember (the calendar person stays) and any open invite for their email here.
   * The business owner memberships are locked first (`FOR UPDATE`, ordered) so two owners removing each other
   * at once cannot both pass the last-owner check. `guard` runs inside the transaction with the target role
   * and the current owner count; throwing from it rolls everything back. The User row is never touched.
   */
  removeMember: (
    businessId: string,
    userId: string,
    guard: (target: { role: Role; ownerCount: number }) => void,
  ) =>
    db.$transaction(async (tx) => {
      const owners = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Membership" WHERE "businessId" = ${businessId} AND role = 'OWNER'
        ORDER BY id FOR UPDATE`;
      const target = await tx.membership.findUnique({
        where: { userId_businessId: { userId, businessId } },
        select: { id: true, role: true, user: { select: { email: true } } },
      });
      if (!target) throw new MemberNotFoundError();
      guard({ role: target.role, ownerCount: owners.length });

      await tx.session.deleteMany({ where: { businessId, userId } });
      await tx.staffMember.updateMany({ where: { businessId, userId }, data: { userId: null } });
      await tx.invite.deleteMany({
        where: { businessId, email: target.user.email, acceptedAt: null },
      });
      const gone = await tx.membership.deleteMany({ where: { id: target.id, businessId } });
      if (gone.count !== 1) throw new MemberNotFoundError();
    }),


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
