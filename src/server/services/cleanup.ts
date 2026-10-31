import { SESSION_ABSOLUTE_TTL_MS } from '@/server/http/cookies';
import type { Logger } from '@/server/http/logger';
import { emailTokenRepo } from '@/server/repositories/emailToken.repo';
import { inviteRepo } from '@/server/repositories/invite.repo';
import { rateLimitRepo } from '@/server/repositories/rateLimit.repo';
import { sessionRepo } from '@/server/repositories/session.repo';

export const CLEANUP_BATCH = 500;
/** Buckets are many and cheap: one indexed delete per 5000. */
export const BUCKET_BATCH = 5000;
export const CLEANUP_BUDGET_MS = 20_000;
const DAY = 24 * 60 * 60 * 1000;
export const INVITE_RETENTION_MS = 7 * DAY;
export const BUCKET_RETENTION_MS = 2 * DAY;

export interface CleanupResult {
  sessions: number;
  invites: number;
  /** Used or expired verify / reset tokens. */
  emailTokens: number;
  rateLimitBuckets: number;
  /** True when the time budget ran out before every table was drained; the next run continues. */
  truncated: boolean;
}

export interface CleanupDeps {
  now: () => Date;
  /** Monotonic milliseconds, for the time budget only. */
  elapsedMs: () => number;
  budgetMs: number;
  batch: number;
}

const defaults = (): CleanupDeps => {
  const started = performance.now();
  return {
    now: () => new Date(),
    elapsedMs: () => performance.now() - started,
    budgetMs: CLEANUP_BUDGET_MS,
    batch: CLEANUP_BATCH,
  };
};

/**
 * Hygiene job (daily): purge dead sessions, stale invites, used or expired email tokens and old rate-limit buckets in batches.
 * WaitlistOffer rows are deliberately kept (pilot reporting). Idempotent and safe to run concurrently.
 */
export async function runCleanup(
  logger: Logger,
  overrides: Partial<CleanupDeps> = {},
): Promise<CleanupResult> {
  const deps = { ...defaults(), ...overrides };
  const now = deps.now();
  const absoluteCutoff = new Date(now.getTime() - SESSION_ABSOLUTE_TTL_MS);
  const inviteCutoff = new Date(now.getTime() - INVITE_RETENTION_MS);
  const bucketCutoff = new Date(now.getTime() - BUCKET_RETENTION_MS);

  const result: CleanupResult = {
    sessions: 0,
    invites: 0,
    emailTokens: 0,
    rateLimitBuckets: 0,
    truncated: false,
  };
  const steps: [
    keyof Omit<CleanupResult, 'truncated'>,
    (limit: number) => Promise<number>,
    number,
  ][] = [
    ['sessions', (n) => sessionRepo.deleteDead(now, absoluteCutoff, n), deps.batch],
    ['invites', (n) => inviteRepo.deleteStale(inviteCutoff, n), deps.batch],
    ['emailTokens', (n) => emailTokenRepo.deleteStale(now, n), deps.batch],
    [
      'rateLimitBuckets',
      (n) => rateLimitRepo.deleteOlderThan(bucketCutoff, n),
      overrides.batch ?? BUCKET_BATCH,
    ],
  ];
  for (const [name, deleteBatch, size] of steps) {
    for (;;) {
      if (deps.elapsedMs() >= deps.budgetMs) {
        result.truncated = true;
        break;
      }
      const deleted = await deleteBatch(size);
      result[name] += deleted;
      if (deleted < size) break;
    }
  }
  logger.info({ ...result }, 'cleanup finished');
  return result;
}
