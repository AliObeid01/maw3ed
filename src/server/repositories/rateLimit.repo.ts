import { db } from './db';

export interface HitResult {
  count: number;
  limited: boolean;
  retryAfterSec: number;
}

/** Start of the fixed window that contains `now`, aligned to multiples of `windowSec` since the epoch. */
export function windowStartOf(now: Date, windowSec: number): Date {
  const ms = windowSec * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

/**
 * Shared fixed-window counters. Global table (keys are hashed emails / IPs, not tenants), so these
 * methods deliberately take no businessId.
 */
export const rateLimitRepo = {
  /**
   * ONE atomic statement: the row is created with count 1 or incremented in place, and the new count is
   * returned. Concurrent callers (even on different serverless instances) each get a distinct count, so
   * exactly `limit` of them see `limited === false`.
   */
  async hit(key: string, windowSec: number, limit: number, now: Date): Promise<HitResult> {
    const start = windowStartOf(now, windowSec);
    const rows = await db.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimitBucket" ("key", "windowStart", "count")
      VALUES (${key}, ${start.toISOString()}::timestamptz, 1)
      ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
      RETURNING "count"`;
    const count = Number(rows[0]!.count);
    const retryAfterSec = Math.max(
      1,
      Math.ceil((start.getTime() + windowSec * 1000 - now.getTime()) / 1000),
    );
    return { count, limited: count > limit, retryAfterSec };
  },

  /** Give back one hit in the current window (a successful login does not spend the per-IP budget). */
  async refund(key: string, windowSec: number, now: Date): Promise<void> {
    const start = windowStartOf(now, windowSec);
    await db.$executeRaw`
      UPDATE "RateLimitBucket" SET "count" = GREATEST("count" - 1, 0)
      WHERE "key" = ${key} AND "windowStart" = ${start.toISOString()}::timestamptz`;
  },

  /** Forget every window of a key. */
  async clear(key: string): Promise<void> {
    await db.rateLimitBucket.deleteMany({ where: { key } });
  },

  /** Cleanup job: delete buckets whose window started before `cutoff`, at most `limit` rows. */
  async deleteOlderThan(cutoff: Date, limit: number): Promise<number> {
    return db.$executeRaw`
      DELETE FROM "RateLimitBucket" WHERE ("key", "windowStart") IN (
        SELECT "key", "windowStart" FROM "RateLimitBucket" WHERE "windowStart" < ${cutoff.toISOString()}::timestamptz LIMIT ${limit}
      )`;
  },
};
