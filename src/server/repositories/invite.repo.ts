import type { Role } from '@/generated/prisma/client';
import { db } from './db';

export interface AcceptInput {
  inviteId: string;
  now: Date;
  /** Existing user to attach, or the details of a new one. */
  user: { existingId: string } | { name: string; passwordHash: string };
  sessionTokenHash: string;
  sessionExpiresAt: Date;
}

/** Thrown inside the accept transaction when the invite was already used or has expired. */
export class InviteGoneError extends Error {}

export const inviteRepo = {
  /** Maintenance (all tenants, cron only): delete up to `limit` invites accepted or expired before `cutoff`. */
  async deleteStale(cutoff: Date, limit: number): Promise<number> {
    const rows = await db.invite.findMany({
      where: { OR: [{ acceptedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] },
      select: { id: true },
      take: limit,
    });
    if (!rows.length) return 0;
    const { count } = await db.invite.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    return count;
  },

  /** Re-inviting an email replaces its previous open invite(s), atomically. */
  replaceOpen: (
    businessId: string,
    data: { email: string; role: Role; tokenHash: string; expiresAt: Date },
  ) =>
    db.$transaction(async (tx) => {
      await tx.invite.deleteMany({ where: { businessId, email: data.email, acceptedAt: null } });
      return tx.invite.create({ data: { businessId, ...data } });
    }),

  /** Not accepted and not expired, oldest first. */
  listPending: (businessId: string, now: Date) =>
    db.invite.findMany({
      where: { businessId, acceptedAt: null, expiresAt: { gt: now } },
      select: { id: true, email: true, role: true, expiresAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),

  /** Not accepted and not expired, newest first (the team screen). */
  listPendingNewestFirst: (businessId: string, now: Date) =>
    db.invite.findMany({
      where: { businessId, acceptedAt: null, expiresAt: { gt: now } },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }),

  /** Delete one unaccepted invite of this business so its link stops working. False = nothing to revoke. */
  async revoke(businessId: string, id: string): Promise<boolean> {
    const { count } = await db.invite.deleteMany({ where: { id, businessId, acceptedAt: null } });
    return count === 1;
  },

  /** Public lookup by token hash (the token itself is the credential); returns the business too. */
  findOpenByTokenHash: (tokenHash: string, now: Date) =>
    db.invite.findFirst({
      where: { tokenHash, acceptedAt: null, expiresAt: { gt: now } },
      include: { business: { select: { id: true, name: true, slug: true, timezone: true } } },
    }),

  /**
   * Single use: the conditional update on `acceptedAt IS NULL` decides the winner; a concurrent loser
   * sees count 0 once the winner commits and gets InviteGoneError (the transaction rolls back).
   */
  accept: (businessId: string, input: AcceptInput) =>
    db.$transaction(async (tx) => {
      const claimed = await tx.invite.updateMany({
        where: {
          id: input.inviteId,
          businessId,
          acceptedAt: null,
          expiresAt: { gt: input.now },
        },
        data: { acceptedAt: input.now },
      });
      if (claimed.count !== 1) throw new InviteGoneError();
      const invite = await tx.invite.findFirstOrThrow({
        where: { id: input.inviteId, businessId },
      });
      // The invite link was e-mailed to this address, so accepting it proves control of the inbox: the user
      // is verified (a new user is created verified; an existing unverified one is marked now).
      const target = input.user;
      let user;
      if ('existingId' in target) {
        await tx.user.updateMany({
          where: { id: target.existingId, emailVerifiedAt: null },
          data: { emailVerifiedAt: input.now },
        });
        user = await tx.user.findUniqueOrThrow({ where: { id: target.existingId } });
      } else {
        user = await tx.user.create({
          data: {
            email: invite.email,
            name: target.name,
            passwordHash: target.passwordHash,
            emailVerifiedAt: input.now,
          },
        });
      }
      await tx.membership.create({ data: { businessId, userId: user.id, role: invite.role } });
      await tx.staffMember.create({
        data: { businessId, userId: user.id, displayName: user.name, bookable: false },
      });
      await tx.session.create({
        data: {
          businessId,
          userId: user.id,
          tokenHash: input.sessionTokenHash,
          expiresAt: input.sessionExpiresAt,
        },
      });
      return { user, role: invite.role };
    }),
};
