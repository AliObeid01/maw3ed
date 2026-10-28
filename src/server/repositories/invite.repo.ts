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
  /** Re-inviting an email replaces its previous open invite(s), atomically. */
  replaceOpen: (
    businessId: string,
    data: { email: string; role: Role; tokenHash: string; expiresAt: Date },
  ) =>
    db.$transaction(async (tx) => {
      await tx.invite.deleteMany({ where: { businessId, email: data.email, acceptedAt: null } });
      return tx.invite.create({ data: { businessId, ...data } });
    }),

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
      const user =
        'existingId' in input.user
          ? await tx.user.findUniqueOrThrow({ where: { id: input.user.existingId } })
          : await tx.user.create({
              data: {
                email: invite.email,
                name: input.user.name,
                passwordHash: input.user.passwordHash,
              },
            });
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
