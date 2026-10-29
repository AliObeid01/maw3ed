import { createHash, timingSafeEqual } from 'node:crypto';
import { verifyToken, type TokenAction, type TokenPayload } from '@/server/domain/tokens';
import { requireLinkSecret } from '@/server/env';
import { appointmentRepo } from '@/server/repositories/appointment.repo';
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

/** Verified signed-link identity: the appointment the token names and the action it was issued for. */
export interface TokenIdentity {
  businessId: string;
  /** The appointment id. */
  subjectId: string;
  action: TokenAction;
  /** Epoch seconds. */
  exp: number;
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

/**
 * Signed-link guard. Verifies the HMAC token from the `token` path parameter against the route's accepted
 * actions. Malformed, forged, unknown or wrong-purpose tokens all answer the same 404 (nothing is
 * revealed); only a genuinely signed token that has expired answers 410 LINK_EXPIRED. The business is
 * resolved from the appointment the token names, never from the request.
 */
export async function resolveToken(
  rawToken: unknown,
  acts: readonly TokenAction[],
  now: Date = new Date(),
): Promise<TokenIdentity> {
  const token = typeof rawToken === 'string' ? rawToken : '';
  const secret = requireLinkSecret();
  let payload: TokenPayload | undefined;
  for (const act of acts) {
    const result = verifyToken(token, secret, now, act);
    if (result.ok) {
      payload = result.payload;
      break;
    }
    if (result.reason === 'expired') throw AppError.gone();
    if (result.reason !== 'wrong_action') throw AppError.notFound();
  }
  if (!payload) throw AppError.notFound();
  // Waitlist offer tokens (`o`) are resolved by the waitlist routes, not here.
  if (payload.a === undefined) throw AppError.notFound();
  const businessId = await appointmentRepo.businessIdOf(payload.a);
  if (!businessId) throw AppError.notFound();
  return { businessId, subjectId: payload.a, action: payload.act, exp: payload.exp };
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
