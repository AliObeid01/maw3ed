import type { EmailTokenKind } from '@/generated/prisma/client';
import { db } from './db';

/**
 * Single-use e-mailed tokens (verify address / reset password). Users are global (one login can belong to
 * several businesses), so like userRepo these methods are not businessId-scoped; the token IS the credential.
 * Only sha256(token) is ever passed in or stored.
 */
export const emailTokenRepo = {
  /**
   * Store a new token and invalidate the older unused tokens of the same kind for that user, atomically:
   * after this call only the new link works.
   */
  issue: (data: { userId: string; kind: EmailTokenKind; tokenHash: string; expiresAt: Date }) =>
    db.$transaction(async (tx) => {
      await tx.emailToken.deleteMany({
        where: { userId: data.userId, kind: data.kind, usedAt: null },
      });
      return tx.emailToken.create({ data });
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
