import type { Prisma } from '@/generated/prisma/client';
import { db } from './db';

/** Thrown inside a transaction when the password hash under the User lock is not the one that was verified. */
export class PasswordChangedError extends Error {}

/**
 * Row-lock the User (`SELECT ... FOR UPDATE`) inside a transaction and return the password hash read UNDER the
 * lock (undefined when the user is gone). USER-ROW LOCK ORDER (F36), the only order any transaction may use:
 *   1. a business's OWNER Membership rows (membership.repo removeMember), then
 *   2. the User row (this function), then
 *   3. anything owned by the user: Session, EmailToken, Invite, Membership of the user.
 * Every password-changing transaction (reset, change) and every session insert that follows a password check
 * (login, invite accept for an existing user) takes this lock first, so a session cannot be inserted with a
 * password that was replaced in between. removeMember never touches the User row, so 1 -> 2 never inverts.
 */
export async function lockUserPasswordHash(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<string | null | undefined> {
  const rows = await tx.$queryRaw<{ passwordHash: string | null }[]>`
    SELECT "passwordHash" FROM "User" WHERE id = ${userId} FOR UPDATE`;
  return rows[0] ? rows[0].passwordHash : undefined;
}

/** Users are global (one login can belong to several businesses), so these are not businessId-scoped. */
export const userRepo = {
  findByEmail: (email: string) => db.user.findUnique({ where: { email } }),
  findById: (id: string) => db.user.findUnique({ where: { id } }),
};
