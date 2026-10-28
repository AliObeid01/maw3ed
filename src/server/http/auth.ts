import { createHash, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors';

export type RoleName = 'OWNER' | 'STAFF';

export interface SessionIdentity {
  userId: string;
  businessId: string;
  role: RoleName;
}

/** Signed-link identity (appointment or waitlist offer). Filled in by the tokens work (P1.6). */
export interface TokenIdentity {
  businessId: string;
  subjectId: string;
  action: string;
}

/** Session resolution arrives with auth (P1.7). Until then, session routes answer 501. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function resolveSession(_req: Request): Promise<SessionIdentity> {
  throw AppError.notImplemented('Session auth is not available yet.');
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
