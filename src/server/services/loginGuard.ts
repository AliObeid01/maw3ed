import { AppError } from '@/server/http/errors';
import { sha256Hex } from './crypto';
import { rateLimiter, type RateLimiter } from './rateLimit';

/**
 * Brute-force guard shared by login and the invite-accept existing-user password path (same keys).
 *
 * - `loginEmailIp`: 5 attempts / 15 min per (sha256(email), ip). A victim is only locked from the
 *   ATTACKER's address; their own address has its own bucket.
 * - `loginIp`: 20 failed logins / 15 min per ip across all emails.
 *
 * Attempts are counted BEFORE the password is checked (one atomic upsert each), so parallel guesses cannot
 * slip past a read-then-write race. A success clears the email+ip bucket and refunds the ip hit, so
 * legitimate sign-ins never spend the per-IP budget.
 */
export interface LoginGuard {
  /** Throws 429 TOO_MANY_ATTEMPTS when either bucket is over its limit. */
  attempt(email: string, ip: string): Promise<void>;
  succeeded(email: string, ip: string): Promise<void>;
}

const emailIp = (email: string, ip: string) => `${sha256Hex(email.trim().toLowerCase())}:${ip}`;

export function createLoginGuard(limiter: RateLimiter): LoginGuard {
  return {
    async attempt(email, ip) {
      const byIp = await limiter.consume('loginIp', ip);
      if (byIp.limited) throw AppError.tooManyAttempts(byIp.retryAfterSec);
      const byPair = await limiter.consume('loginEmailIp', emailIp(email, ip));
      if (byPair.limited) throw AppError.tooManyAttempts(byPair.retryAfterSec);
    },
    async succeeded(email, ip) {
      await limiter.clear('loginEmailIp', emailIp(email, ip));
      await limiter.refund('loginIp', ip);
    },
  };
}

export const loginGuard: LoginGuard = createLoginGuard(rateLimiter);
