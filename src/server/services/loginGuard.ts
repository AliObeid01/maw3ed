import { UNKNOWN_IP } from '@/server/http/clientIp';
import { AppError } from '@/server/http/errors';
import { sha256Hex } from './crypto';
import { rateLimiter, type RateLimiter } from './rateLimit';

/**
 * Brute-force guard shared by login and the invite-accept existing-user password path (same keys).
 * Three dimensions, all counted BEFORE the password is checked (one atomic upsert each), so parallel
 * guesses cannot slip past a read-then-write race:
 *
 * 1. `loginEmailIp`: 5 / 15 min per (sha256(email), ip). A victim is only locked from the ATTACKER's
 *    address; their own address has its own bucket.
 * 2. `loginEmail`: 30 / hour per email across every IP (loose ceiling against rotating addresses).
 * 3. `loginIp`: 20 / 15 min per ip across all emails (credential stuffing). Skipped when the address is
 *    unknown (no trustworthy header): one shared bucket would lock everybody out.
 *
 * The pair is checked FIRST: hammering one locked account stops there and never spends the shared
 * per-IP budget of a salon behind one NAT. A success clears the pair bucket and refunds the hits it took
 * from the email and ip buckets, so only failures accumulate there.
 *
 * Residual risk: with many /64s an attacker can still reach the 30/h per-email ceiling and lock that
 * email for up to an hour. Accepted: the alternative (no ceiling) lets rotating addresses guess freely.
 *
 * If the store errors or times out the limiter falls back to per-instance memory counters (best effort).
 */
export interface LoginTicket {
  email?: Date;
  ip?: Date;
}

export interface LoginGuard {
  /** Throws 429 TOO_MANY_ATTEMPTS when any bucket is over its limit. */
  attempt(email: string, ip: string): Promise<LoginTicket>;
  succeeded(email: string, ip: string, ticket?: LoginTicket): Promise<void>;
}

/** Subject for the pair bucket: key is `loginEmailIp:<sha256(lowercased email)>:<ip>`. */
export const emailHash = (email: string) => sha256Hex(email.trim().toLowerCase());
export const emailIpSubject = (email: string, ip: string) => `${emailHash(email)}:${ip}`;

export function createLoginGuard(limiter: RateLimiter): LoginGuard {
  const opts = { memoryFallback: true };
  return {
    async attempt(email, ip) {
      const pair = await limiter.consume('loginEmailIp', emailIpSubject(email, ip), opts);
      if (pair.limited) throw AppError.tooManyAttempts(pair.retryAfterSec);
      const byEmail = await limiter.consume('loginEmail', emailHash(email), opts);
      if (byEmail.limited) throw AppError.tooManyAttempts(byEmail.retryAfterSec);
      const ticket: LoginTicket = { email: byEmail.windowStart };
      if (ip !== UNKNOWN_IP) {
        const byIp = await limiter.consume('loginIp', ip, opts);
        if (byIp.limited) throw AppError.tooManyAttempts(byIp.retryAfterSec);
        ticket.ip = byIp.windowStart;
      }
      return ticket;
    },
    async succeeded(email, ip, ticket = {}) {
      await limiter.clear('loginEmailIp', emailIpSubject(email, ip));
      await limiter.refund('loginEmail', emailHash(email), ticket.email);
      if (ip !== UNKNOWN_IP) await limiter.refund('loginIp', ip, ticket.ip);
    },
  };
}

export const loginGuard: LoginGuard = createLoginGuard(rateLimiter);
