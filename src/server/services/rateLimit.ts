import { rootLogger, type Logger } from '@/server/http/logger';
import { rateLimitRepo, type HitResult } from '@/server/repositories/rateLimit.repo';
import { RATE_POLICIES, type RatePolicyName } from './rateLimitPolicies';

export interface RateLimitStore {
  hit(key: string, windowSec: number, limit: number, now: Date): Promise<HitResult>;
  refund(key: string, windowSec: number, now: Date): Promise<void>;
  clear(key: string): Promise<void>;
}

export interface RateLimitDeps {
  now: () => Date;
  store: RateLimitStore;
  logger: Logger;
}

export interface RateDecision {
  limited: boolean;
  retryAfterSec: number;
  count: number;
}

const OPEN: RateDecision = { limited: false, retryAfterSec: 0, count: 0 };

/** Key = `<policy>:<subject>`. Subjects are an ip or `sha256(email):ip`; never a raw email. */
export const rateKey = (policy: RatePolicyName, subject: string) => `${policy}:${subject}`;

export interface RateLimiter {
  /** Count one hit. Fails OPEN (logs, returns not-limited) when the store is unavailable. */
  consume(policy: RatePolicyName, subject: string): Promise<RateDecision>;
  refund(policy: RatePolicyName, subject: string): Promise<void>;
  clear(policy: RatePolicyName, subject: string): Promise<void>;
}

/** A limiter over a store and a clock. Separate instances over the same database share every counter. */
export function createRateLimiter(overrides: Partial<RateLimitDeps> = {}): RateLimiter {
  const deps: RateLimitDeps = {
    now: () => new Date(),
    store: rateLimitRepo,
    logger: rootLogger,
    ...overrides,
  };
  /** A broken limiter must never block bookings or logins outright: log and let the request through. */
  const safely = async <T>(op: string, policy: string, fn: () => Promise<T>, fallback: T) => {
    try {
      return await fn();
    } catch (error) {
      deps.logger.error(
        { policy, op, err: { name: (error as Error)?.name, message: (error as Error)?.message } },
        'rate limit store failed; failing open',
      );
      return fallback;
    }
  };
  return {
    consume: (policy, subject) =>
      safely(
        'hit',
        policy,
        () => {
          const { windowSec, limit } = RATE_POLICIES[policy];
          return deps.store.hit(rateKey(policy, subject), windowSec, limit, deps.now());
        },
        OPEN,
      ),
    refund: (policy, subject) =>
      safely(
        'refund',
        policy,
        () =>
          deps.store.refund(rateKey(policy, subject), RATE_POLICIES[policy].windowSec, deps.now()),
        undefined,
      ),
    clear: (policy, subject) =>
      safely('clear', policy, () => deps.store.clear(rateKey(policy, subject)), undefined),
  };
}

export const rateLimiter: RateLimiter = createRateLimiter();

/** Route-level switch for tests that fire many requests from one fake address. Ignored in production. */
export const routeRateLimitDisabled = () =>
  process.env.NODE_ENV !== 'production' && process.env.RATE_LIMIT_DISABLED === '1';
