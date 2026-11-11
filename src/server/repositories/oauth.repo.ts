import { db } from './db';

/**
 * OAuth state of the owner assistant connector (docs/MCP_OWNER.md). Raw codes and tokens never reach this file:
 * callers pass sha256 hashes. The only tenant-scoped reads are the owner's grant list and revoke (businessId first);
 * everything else is looked up by a secret hash, which IS what decides the tenant.
 */

/** A retry with the refresh token that was rotated away this recently is a lost response, not theft. */
export const REFRESH_GRACE_MS = 20_000;

export interface ClientRow {
  clientId: string;
  name: string;
  redirectUris: string[];
}

export interface CodeRow {
  id: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string | null;
  scope: string;
  userId: string;
  businessId: string;
  grantId: string | null;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface NewCode {
  codeHash: string;
  consentNonce: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string | null;
  scope: string;
  userId: string;
  businessId: string;
  expiresAt: Date;
}

export interface GrantContext {
  grantId: string;
  businessId: string;
  userId: string;
  clientId: string;
  scope: string;
  revoked: boolean;
  tokenExpiresAt: Date;
}

export type ClaimResult =
  | { kind: 'claimed'; code: CodeRow }
  | { kind: 'replayed'; grantId: string | null }
  | { kind: 'invalid' };

export type RotateResult =
  | { kind: 'rotated'; grantId: string; businessId: string; userId: string; clientId: string }
  | { kind: 'reuse'; grantId: string }
  | { kind: 'grace' }
  | { kind: 'invalid' };

export interface NewTokens {
  accessHash: string;
  accessExpiresAt: Date;
  refreshHash: string;
  refreshExpiresAt: Date;
}

const codeSelect = {
  id: true,
  clientId: true,
  redirectUri: true,
  codeChallenge: true,
  resource: true,
  scope: true,
  userId: true,
  businessId: true,
  grantId: true,
  expiresAt: true,
  usedAt: true,
} as const;

export const oauthRepo = {
  /* ---------------------------------- clients ---------------------------------- */
  createClient: (data: ClientRow) => db.oAuthClient.create({ data }).then(() => undefined),

  findClient: (clientId: string): Promise<ClientRow | null> =>
    db.oAuthClient.findUnique({
      where: { clientId },
      select: { clientId: true, name: true, redirectUris: true },
    }),

  /* ---------------------------------- authorization codes ---------------------------------- */
  /** Throws a unique violation when the consent nonce was used before (one-time consent). */
  insertCode: (data: NewCode) => db.oAuthAuthorizationCode.create({ data }).then(() => undefined),

  /**
   * Atomic single-use claim: only ONE caller can flip `usedAt` from NULL. A code that was already used reports
   * `replayed` (with the grant it produced, so the caller can revoke it); an unknown or expired one is `invalid`.
   */
  async claimCode(codeHash: string, now: Date): Promise<ClaimResult> {
    const claimed = await db.oAuthAuthorizationCode.updateMany({
      where: { codeHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    const row = await db.oAuthAuthorizationCode.findUnique({ where: { codeHash }, select: codeSelect });
    if (!row) return { kind: 'invalid' };
    if (claimed.count === 1) return { kind: 'claimed', code: row };
    if (row.usedAt) return { kind: 'replayed', grantId: row.grantId };
    return { kind: 'invalid' }; // expired
  },

  /** The code row without touching it (validation happens before the claim). */
  peekCode: (codeHash: string): Promise<CodeRow | null> =>
    db.oAuthAuthorizationCode.findUnique({ where: { codeHash }, select: codeSelect }),

  /**
   * Claim the code AND create the grant with its first token pair in ONE transaction, so there is no window in which
   * the code is used but no grant is linked to it. A second caller blocks on the row lock until the first commits,
   * then sees a used code WITH its grant: `replayed` (the caller revokes that grant).
   */
  claimAndIssue: (
    codeHash: string,
    now: Date,
    clientName: string,
    tokens: NewTokens,
  ): Promise<{ kind: 'issued'; grantId: string; scope: string } | { kind: 'replayed'; grantId: string | null } | { kind: 'invalid' }> =>
    db.$transaction(async (tx) => {
      const claimed = await tx.oAuthAuthorizationCode.updateMany({
        where: { codeHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      const code = await tx.oAuthAuthorizationCode.findUnique({ where: { codeHash }, select: codeSelect });
      if (!code) return { kind: 'invalid' as const };
      if (claimed.count !== 1) return code.usedAt ? { kind: 'replayed' as const, grantId: code.grantId } : { kind: 'invalid' as const };
      const grant = await tx.oAuthGrant.create({
        data: {
          businessId: code.businessId,
          userId: code.userId,
          clientId: code.clientId,
          clientName,
          scope: code.scope,
        },
        select: { id: true },
      });
      await tx.oAuthAuthorizationCode.updateMany({ where: { id: code.id }, data: { grantId: grant.id } });
      await tx.oAuthAccessToken.create({
        data: { grantId: grant.id, tokenHash: tokens.accessHash, expiresAt: tokens.accessExpiresAt },
      });
      await tx.oAuthRefreshToken.create({
        data: { grantId: grant.id, tokenHash: tokens.refreshHash, expiresAt: tokens.refreshExpiresAt },
      });
      return { kind: 'issued' as const, grantId: grant.id, scope: code.scope };
    }),

  /* ---------------------------------- refresh rotation ---------------------------------- */
  /** The grant behind a refresh token, read before any transaction (owner checks happen outside it). */
  async findRefreshGrant(refreshHash: string) {
    const row = await db.oAuthRefreshToken.findUnique({
      where: { tokenHash: refreshHash },
      select: {
        grantId: true,
        usedAt: true,
        grant: { select: { businessId: true, userId: true, clientId: true, revokedAt: true } },
      },
    });
    return row
      ? {
          grantId: row.grantId,
          usedAt: row.usedAt,
          businessId: row.grant.businessId,
          userId: row.grant.userId,
          clientId: row.grant.clientId,
          revoked: row.grant.revokedAt !== null,
        }
      : null;
  },

  /**
   * Rotate in one transaction (no other connection is used inside it): mark the presented refresh token used (only
   * while it is unused, unexpired, of a live grant and of THIS client), drop the grant's old access tokens and store
   * the next pair. A token that was rotated away less than REFRESH_GRACE_MS ago is `grace` (a retry of a lost
   * response: refused, nothing revoked); an older one is `reuse` and the caller revokes the whole grant.
   */
  rotateRefresh: (
    refreshHash: string,
    now: Date,
    next: NewTokens,
    clientId: string,
  ): Promise<RotateResult> =>
    db.$transaction(async (tx): Promise<RotateResult> => {
      const row = await tx.oAuthRefreshToken.findUnique({
        where: { tokenHash: refreshHash },
        select: {
          id: true,
          grantId: true,
          usedAt: true,
          expiresAt: true,
          grant: { select: { businessId: true, userId: true, clientId: true, revokedAt: true } },
        },
      });
      if (!row || row.grant.revokedAt || row.grant.clientId !== clientId) return { kind: 'invalid' };
      const spent = (usedAt: Date): RotateResult =>
        now.getTime() - usedAt.getTime() <= REFRESH_GRACE_MS
          ? { kind: 'grace' }
          : { kind: 'reuse', grantId: row.grantId };
      if (row.usedAt) return spent(row.usedAt);
      if (row.expiresAt <= now) return { kind: 'invalid' };
      const claimed = await tx.oAuthRefreshToken.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) {
        // Lost the race to a concurrent refresh with the same token: same rule as any other spent token.
        const again = await tx.oAuthRefreshToken.findUnique({ where: { id: row.id }, select: { usedAt: true } });
        return again?.usedAt ? spent(again.usedAt) : { kind: 'invalid' };
      }
      await tx.oAuthAccessToken.deleteMany({ where: { grantId: row.grantId } });
      await tx.oAuthAccessToken.create({
        data: { grantId: row.grantId, tokenHash: next.accessHash, expiresAt: next.accessExpiresAt },
      });
      await tx.oAuthRefreshToken.create({
        data: { grantId: row.grantId, tokenHash: next.refreshHash, expiresAt: next.refreshExpiresAt },
      });
      return {
        kind: 'rotated',
        grantId: row.grantId,
        businessId: row.grant.businessId,
        userId: row.grant.userId,
        clientId: row.grant.clientId,
      };
    }),

  /* ---------------------------------- access-token resolution ---------------------------------- */
  /** Not tenant-scoped on purpose: the token decides the tenant. */
  async findByAccessHash(tokenHash: string): Promise<GrantContext | null> {
    const row = await db.oAuthAccessToken.findUnique({
      where: { tokenHash },
      select: {
        expiresAt: true,
        grant: {
          select: { id: true, businessId: true, userId: true, clientId: true, scope: true, revokedAt: true },
        },
      },
    });
    if (!row) return null;
    return {
      grantId: row.grant.id,
      businessId: row.grant.businessId,
      userId: row.grant.userId,
      clientId: row.grant.clientId,
      scope: row.grant.scope,
      revoked: row.grant.revokedAt !== null,
      tokenExpiresAt: row.expiresAt,
    };
  },

  /** Throttled to once a minute per grant: the list shows "last used", it is not an audit trail. */
  touch: (grantId: string, now: Date) =>
    db.oAuthGrant
      .updateMany({
        where: {
          id: grantId,
          OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - 60_000) } }],
        },
        data: { lastUsedAt: now },
      })
      .then(() => undefined),

  /** The grant a presented access or refresh token belongs to (RFC 7009 revocation), or null. */
  async grantIdOfToken(tokenHash: string): Promise<string | null> {
    const a = await db.oAuthAccessToken.findUnique({ where: { tokenHash }, select: { grantId: true } });
    if (a) return a.grantId;
    const r = await db.oAuthRefreshToken.findUnique({ where: { tokenHash }, select: { grantId: true } });
    return r?.grantId ?? null;
  },

  /* ---------------------------------- revoking ---------------------------------- */
  /** Revoke by grant id (system paths: replay, reuse, demoted owner). Deletes the token hashes too. */
  revokeGrant: (grantId: string, reason: string, now: Date) =>
    db.$transaction(async (tx) => {
      await tx.oAuthGrant.updateMany({
        where: { id: grantId, revokedAt: null },
        data: { revokedAt: now, revokedReason: reason },
      });
      await tx.oAuthAccessToken.deleteMany({ where: { grantId } });
      await tx.oAuthRefreshToken.deleteMany({ where: { grantId } });
    }),

  /** Owner revoke: only a grant of THIS business. false = not found (other business, unknown or already revoked). */
  revokeForBusiness: (businessId: string, grantId: string, now: Date) =>
    db.$transaction(async (tx) => {
      const res = await tx.oAuthGrant.updateMany({
        where: { id: grantId, businessId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'owner' },
      });
      if (res.count !== 1) return false;
      await tx.oAuthAccessToken.deleteMany({ where: { grantId } });
      await tx.oAuthRefreshToken.deleteMany({ where: { grantId } });
      return true;
    }),

  listActive: (businessId: string) =>
    db.oAuthGrant.findMany({
      where: { businessId, revokedAt: null },
      select: { id: true, clientName: true, createdAt: true, lastUsedAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    }),

  /* ---------------------------------- hygiene ---------------------------------- */
  /**
   * Purge what can no longer be used, in batches (a job over all tenants): expired codes and tokens, grants revoked
   * more than 30 days ago, dynamic clients with no grant after 7 days, plans expired for 7 days.
   * Returns the number of rows deleted.
   */
  async purge(now: Date, limit: number): Promise<number> {
    const day = 24 * 60 * 60 * 1000;
    const del = async (rows: Promise<unknown>) => Number(await rows);
    let total = 0;
    total += await del(
      db.$executeRaw`DELETE FROM "OAuthAuthorizationCode" WHERE id IN (SELECT id FROM "OAuthAuthorizationCode" WHERE "expiresAt" < ${new Date(now.getTime() - day)} LIMIT ${limit})`,
    );
    total += await del(
      db.$executeRaw`DELETE FROM "OAuthAccessToken" WHERE id IN (SELECT id FROM "OAuthAccessToken" WHERE "expiresAt" < ${now} LIMIT ${limit})`,
    );
    total += await del(
      db.$executeRaw`DELETE FROM "OAuthRefreshToken" WHERE id IN (SELECT id FROM "OAuthRefreshToken" WHERE "expiresAt" < ${now} LIMIT ${limit})`,
    );
    total += await del(
      db.$executeRaw`DELETE FROM "OAuthGrant" WHERE id IN (SELECT id FROM "OAuthGrant" WHERE "revokedAt" < ${new Date(now.getTime() - 30 * day)} LIMIT ${limit})`,
    );
    total += await del(
      db.$executeRaw`DELETE FROM "OAuthClient" WHERE id IN (SELECT c.id FROM "OAuthClient" c WHERE c."createdAt" < ${new Date(now.getTime() - 7 * day)} AND NOT EXISTS (SELECT 1 FROM "OAuthGrant" g WHERE g."clientId" = c."clientId") LIMIT ${limit})`,
    );
    total += await del(
      db.$executeRaw`DELETE FROM "McpPlan" WHERE id IN (SELECT id FROM "McpPlan" WHERE "expiresAt" < ${new Date(now.getTime() - 7 * day)} LIMIT ${limit})`,
    );
    return total;
  },
};
