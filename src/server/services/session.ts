import {
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_REFRESH_AFTER_MS,
  SESSION_TTL_MS,
} from '@/server/http/cookies';
import type { RoleName } from '@/server/http/auth';
import { membershipRepo } from '@/server/repositories/membership.repo';
import { sessionRepo } from '@/server/repositories/session.repo';
import { newOpaqueToken, sha256Hex } from './crypto';

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  businessId: string;
  role: RoleName;
  /** Set when the sliding expiry was just extended: the caller re-issues the cookie. */
  refreshed?: { expiresAt: Date };
}

export interface SessionStore {
  findByTokenHash(tokenHash: string): Promise<{
    id: string;
    userId: string;
    businessId: string;
    expiresAt: Date;
    lastSeenAt: Date;
    createdAt: Date;
  } | null>;
  touch(businessId: string, id: string, lastSeenAt: Date, expiresAt: Date): Promise<void>;
  findRole(businessId: string, userId: string): Promise<{ role: RoleName } | null>;
}

const defaultStore: SessionStore = {
  findByTokenHash: sessionRepo.findByTokenHash,
  touch: sessionRepo.touch,
  findRole: membershipRepo.findRole,
};

export const newSessionExpiry = (now: Date) => new Date(now.getTime() + SESSION_TTL_MS);

export const sessionService = {
  /** A new random token and its hash/expiry, to be stored by the caller (inside its own transaction). */
  issue(now: Date = new Date()) {
    const token = newOpaqueToken();
    return { token, tokenHash: sha256Hex(token), expiresAt: newSessionExpiry(now) };
  },

  async create(businessId: string, userId: string, now: Date = new Date()) {
    const issued = this.issue(now);
    await sessionRepo.create(businessId, {
      userId,
      tokenHash: issued.tokenHash,
      expiresAt: issued.expiresAt,
    });
    return { token: issued.token, expiresAt: issued.expiresAt };
  },

  /**
   * Cookie token -> identity, or undefined (unknown, expired, or the membership is gone).
   * The role is read from Membership on every request so a removed member loses access at once.
   * The expiry slides forward at most once an hour.
   */
  async resolve(
    token: string,
    now: Date = new Date(),
    store: SessionStore = defaultStore,
  ): Promise<ResolvedSession | undefined> {
    const session = await store.findByTokenHash(sha256Hex(token));
    if (!session || session.expiresAt.getTime() <= now.getTime()) return undefined;
    // Absolute lifetime: a session that has existed for 90 days ends, however recently it was used.
    const hardEnd = session.createdAt.getTime() + SESSION_ABSOLUTE_TTL_MS;
    if (now.getTime() >= hardEnd) return undefined;
    const membership = await store.findRole(session.businessId, session.userId);
    if (!membership) return undefined;

    const resolved: ResolvedSession = {
      sessionId: session.id,
      userId: session.userId,
      businessId: session.businessId,
      role: membership.role,
    };
    if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_REFRESH_AFTER_MS) {
      // Sliding expiry never moves past the absolute end.
      const expiresAt = new Date(Math.min(newSessionExpiry(now).getTime(), hardEnd));
      await store.touch(session.businessId, session.id, now, expiresAt);
      resolved.refreshed = { expiresAt };
    }
    return resolved;
  },

  destroy: (businessId: string, sessionId: string) => sessionRepo.deleteById(businessId, sessionId),
};
