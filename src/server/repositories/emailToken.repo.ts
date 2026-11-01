import type { EmailTokenKind } from '@/generated/prisma/client';
import { db } from './db';
import { lockUserPasswordHash } from './user.repo';

/**
 * Single-use e-mailed tokens (verify address / reset password). Users are global (one login can belong to
 * several businesses), so like userRepo these methods are not businessId-scoped; the token IS the credential.
 * Only sha256(token) is ever passed in or stored.
 */
/** Unused tokens kept per user and kind. */
export const MAX_LIVE_TOKENS = 5;

export const emailTokenRepo = {
  /**
   * Store a new token. Older unused tokens of the same kind are NOT invalidated (otherwise anyone could kill the
   * link a user is about to click by asking again); instead at most MAX_LIVE_TOKENS unused tokens are kept per
   * user and kind and the oldest beyond that are deleted. Several valid links may therefore coexist for at most
   * their lifetime (1 h reset, 24 h verify); all are single use and all are deleted when one succeeds.
   */
  issue: (data: { userId: string; kind: EmailTokenKind; tokenHash: string; expiresAt: Date }) =>
    db.$transaction(async (tx) => {
      const created = await tx.emailToken.create({ data });
      const unused = await tx.emailToken.findMany({
        where: { userId: data.userId, kind: data.kind, usedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      const surplus = unused.slice(MAX_LIVE_TOKENS).map((t) => t.id);
      if (surplus.length) await tx.emailToken.deleteMany({ where: { id: { in: surplus } } });
      return created;
    }),

  /** Read-only: the user a usable (unused, unexpired) token of this kind belongs to. Never changes state. */
  async findUsable(kind: EmailTokenKind, tokenHash: string, now: Date) {
    return db.emailToken.findFirst({
      where: { kind, tokenHash, usedAt: null, expiresAt: { gt: now } },
      select: { id: true, userId: true },
    });
  },

  /**
   * Single use: the conditional update on `usedAt IS NULL AND expiresAt > now` decides the winner, and the
   * user is marked verified in the same transaction. Returns the user id, or null when the token is not
   * usable (unknown, wrong kind, expired, already used, lost a race).
   */
  verifyEmail: (tokenHash: string, now: Date): Promise<string | null> =>
    db.$transaction(async (tx) => {
      const token = await tx.emailToken.findUnique({ where: { tokenHash } });
      if (!token || token.kind !== 'VERIFY') return null;
      const claimed = await tx.emailToken.updateMany({
        where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) return null;
      await tx.user.updateMany({
        where: { id: token.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: now },
      });
      // Success consumes every other open verification link of this user.
      await tx.emailToken.deleteMany({
        where: { userId: token.userId, kind: 'VERIFY', usedAt: null },
      });
      return token.userId;
    }),

  /**
   * Single use, like verifyEmail: claim the RESET token, set the new hash, mark the email verified (they
   * proved control of the inbox), delete EVERY session of the user (all businesses) and any other open reset
   * link, all in one transaction. Returns the user id, or null when the token is not usable.
   */
  resetPassword: (tokenHash: string, now: Date, passwordHash: string): Promise<string | null> =>
    db.$transaction(async (tx) => {
      const token = await tx.emailToken.findUnique({ where: { tokenHash } });
      if (!token || token.kind !== 'RESET') return null;
      // Lock the User row BEFORE claiming the token (F36, lock order in lockUserPasswordHash): a login that
      // verified the old password either committed its session first (deleted below) or is rejected.
      await lockUserPasswordHash(tx, token.userId);
      const claimed = await tx.emailToken.updateMany({
        where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) return null;
      await tx.user.update({ where: { id: token.userId }, data: { passwordHash } });
      await tx.user.updateMany({
        where: { id: token.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: now },
      });
      await tx.session.deleteMany({ where: { userId: token.userId } });
      await tx.emailToken.deleteMany({
        where: { userId: token.userId, kind: 'RESET', usedAt: null },
      });
      return token.userId;
    }),

  /** Maintenance (all tenants, cron only): delete up to `limit` tokens that are used or already expired at `now`. */
  async deleteStale(now: Date, limit: number): Promise<number> {
    const rows = await db.emailToken.findMany({
      where: { OR: [{ usedAt: { not: null } }, { expiresAt: { lt: now } }] },
      select: { id: true },
      take: limit,
    });
    if (!rows.length) return 0;
    const { count } = await db.emailToken.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    return count;
  },
};
