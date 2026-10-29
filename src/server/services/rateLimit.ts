import { rootLogger, type Logger } from '@/server/http/logger';
import { rateLimitRepo, type HitResult } from '@/server/repositories/rateLimit.repo';
import {
  RATE_POLICIES,
  SOFT_POLICIES,
  SOFT_THRESHOLD,
  type RatePolicyName,
} from './rateLimitPolicies';

export const STORE_TIMEOUT_MS = 300;
/** Structured log event name to alert on: the limiter store failed or timed out and we let traffic through. */
export const FAIL_OPEN_EVENT = 'rate_limit_fail_open';

export interface RateLimitStore {
  hit(
    key: string,
    windowSec: number,
    limit: number,
    now: Date,
    amount?: number,
  ): Promise<HitResult>;
  refund(key: string, windowStart: Date): Promise<void>;
  clear(key: string): Promise<void>;
}

export interface RateLimitDeps {
  now: () => Date;
  store: RateLimitStore;
  logger: Logger;
  timeoutMs: number;
}

export interface RateDecision {
  limited: boolean;
  retryAfterSec: number;
  count: number;
  /** Window the hit was counted in (undefined when nothing was written): hand it to refund(). */
  windowStart?: Date;
}

export interface ConsumeOptions {
  /**
   * When the store fails or times out: count in a small per-instance memory map instead of failing fully
   * open (used by the login guard). Route limits leave this off and fail open.
   */
  memoryFallback?: boolean;
}

/** Key = `<policy>:<subject>`. Subjects are an ip or `sha256(email)[:ip]`; never a raw email. */
export const rateKey = (policy: RatePolicyName, subject: string) => `${policy}:${subject}`;

export interface RateLimiter {
  consume(policy: RatePolicyName, subject: string, opts?: ConsumeOptions): Promise<RateDecision>;
  refund(policy: RatePolicyName, subject: string, windowStart?: Date): Promise<void>;
  clear(policy: RatePolicyName, subject: string): Promise<void>;
  /** Fail-open count since this limiter was created (the "counter" for alerts and tests). */
  failOpenCount(): number;
}

interface MemEntry {
  count: number;
  /** How much of `count` Postgres already knows about (soft policies). */
  synced: number;
  limited: boolean;
  windowEnd: number;
}

const MEM_MAX_ENTRIES = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`rate limit store timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** A limiter over a store and a clock. Separate instances over the same database share every counter. */
export function createRateLimiter(overrides: Partial<RateLimitDeps> = {}): RateLimiter {
  const deps: RateLimitDeps = {
    now: () => new Date(),
    store: rateLimitRepo,
    logger: rootLogger,
    timeoutMs: STORE_TIMEOUT_MS,
    ...overrides,
  };
  let failOpens = 0;
  /** Per-instance counters: soft-policy short-circuit and the login fallback. */
  const memory = new Map<string, MemEntry>();

  const memEntry = (key: string, windowSec: number, now: Date): MemEntry => {
    const ms = windowSec * 1000;
    const start = Math.floor(now.getTime() / ms) * ms;
    const id = `${key}|${start}`;
    let entry = memory.get(id);
    if (!entry) {
      if (memory.size >= MEM_MAX_ENTRIES) {
        for (const [k, v] of memory) if (v.windowEnd <= now.getTime()) memory.delete(k);
        if (memory.size >= MEM_MAX_ENTRIES) memory.clear(); // flood of distinct keys: start over
      }
      entry = { count: 0, synced: 0, limited: false, windowEnd: start + ms };
      memory.set(id, entry);
    }
    return entry;
  };
  const secondsLeft = (entry: MemEntry, now: Date) =>
    Math.max(1, Math.ceil((entry.windowEnd - now.getTime()) / 1000));

  const failOpen = (op: string, policy: string, error: unknown) => {
    failOpens++;
    deps.logger.error(
      {
        event: FAIL_OPEN_EVENT,
        policy,
        op,
        err: { name: (error as Error)?.name, message: (error as Error)?.message },
      },
      'rate limit store failed; failing open',
    );
  };

  const run = <T>(fn: () => Promise<T>) => withTimeout(fn(), deps.timeoutMs);

  return {
    failOpenCount: () => failOpens,

    async consume(policy, subject, opts = {}) {
      const { windowSec, limit } = RATE_POLICIES[policy];
      const key = rateKey(policy, subject);
      const now = deps.now();
      const soft = SOFT_POLICIES.has(policy);
      let amount = 1;
      let entry: MemEntry | undefined;

      if (soft) {
        entry = memEntry(key, windowSec, now);
        // Once Postgres said "limited", a flood costs no more writes until the window ends.
        if (entry.limited)
          return { limited: true, retryAfterSec: secondsLeft(entry, now), count: limit + 1 };
        entry.count++;
        if (entry.count < Math.ceil(limit * SOFT_THRESHOLD))
          return { limited: false, retryAfterSec: 0, count: entry.count };
        amount = entry.count - entry.synced; // catch Postgres up to what this instance has seen
      }

      try {
        const res = await run(() => deps.store.hit(key, windowSec, limit, now, amount));
        if (entry) {
          entry.synced += amount;
          if (res.limited) entry.limited = true;
        }
        return res;
      } catch (error) {
        failOpen('hit', policy, error);
        if (!opts.memoryFallback) return { limited: false, retryAfterSec: 0, count: 0 };
        const fb = memEntry(`fallback:${key}`, windowSec, now);
        fb.count++;
        return {
          limited: fb.count > limit,
          retryAfterSec: secondsLeft(fb, now),
          count: fb.count,
        };
      }
    },

    async refund(policy, subject, windowStart) {
      if (!windowStart) return;
      try {
        await run(() => deps.store.refund(rateKey(policy, subject), windowStart));
      } catch (error) {
        failOpen('refund', policy, error);
      }
    },

    async clear(policy, subject) {
      try {
        await run(() => deps.store.clear(rateKey(policy, subject)));
      } catch (error) {
        failOpen('clear', policy, error);
      }
    },
  };
}

export const rateLimiter: RateLimiter = createRateLimiter();

/** Route-level switch for tests that fire many requests from one fake address. Ignored in production. */
export const routeRateLimitDisabled = () =>
  process.env.NODE_ENV !== 'production' && process.env.RATE_LIMIT_DISABLED === '1';
