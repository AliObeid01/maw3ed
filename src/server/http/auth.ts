import { createHash, timingSafeEqual } from 'node:crypto';
import { sessionService } from '@/server/services/session';
import { readSessionToken } from './cookies';
import { AppError } from './errors';

export type RoleName = 'OWNER' | 'STAFF';

export interface SessionIdentity {
  userId: string;
  businessId: string;
  role: RoleName;
  sessionId: string;
  /** Present when the sliding expiry was extended on this request: withRoute re-issues the cookie. */
  refresh?: { token: string; expiresAt: Date };
}

/** Signed-link identity (appointment or waitlist offer). Filled in by the tokens work (P1.6). */
export interface TokenIdentity {
  businessId: string;
  subjectId: string;
  action: string;
}

/** Cookie -> Session -> Membership. 401 for a missing, unknown, expired or orphaned session. */
export async function resolveSession(
  req: Request,
  now: Date = new Date(),
): Promise<SessionIdentity> {
  const token = readSessionToken(req.headers.get('cookie'));
  if (!token) throw AppError.unauthenticated();
  const resolved = await sessionService.resolve(token, now);
  if (!resolved) throw AppError.unauthenticated();
  const { refreshed, ...identity } = resolved;
  return refreshed ? { ...identity, refresh: { token, expiresAt: refreshed.expiresAt } } : identity;
}

/** Role guard for services: `requireRole(ctx, 'OWNER')`. Wrong or missing role -> 403. */
export function requireRole(ctx: { role?: RoleName }, ...allowed: RoleName[]): void {
  if (!ctx.role || !allowed.includes(ctx.role)) throw AppError.forbidden();
}

/** Signed token verification arrives with P1.6/P2.x. Until then, token routes answer 501. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function resolveToken(_req: Request, _params: unknown): Promise<TokenIdentity> {
  throw AppError.notImplemented('Token auth is not available yet.');
}

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Constant-time string comparison (hashing first so differing lengths do not leak). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

/** Cron guard: `x-cron-secret` must equal CRON_SECRET. A missing secret or header always fails. */
export function assertCronSecret(req: Request, expected = process.env.CRON_SECRET): void {
  const given = req.headers.get('x-cron-secret');
  if (!expected || !given || !safeEqual(given, expected))
    throw AppError.unauthenticated('Invalid cron secret.');
}
