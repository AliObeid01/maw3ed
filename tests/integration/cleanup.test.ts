import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { POST as cleanupJob } from '@/app/api/jobs/cleanup/route';
import { GET as me } from '@/app/api/me/route';
import { rootLogger } from '@/server/http/logger';
import { runCleanup } from '@/server/services/cleanup';
import { call, signup } from './helpers/api';
import { newClient, setupSchema, truncateAll } from './helpers/db';

let pg: Client;
beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
});
afterAll(async () => {
  await pg.end();
});
beforeEach(async () => {
  await truncateAll(pg);
});

const count = async (table: string) =>
  Number((await pg.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n);

/** Insert dead and live rows for one business; returns the live session cookie. */
async function seed() {
  const { cookie, info } = await signup();
  const businessId = info.business.id as string;
  const userId = info.user.id as string;
  const session = (n: string, expires: string, created: string) =>
    pg.query(
      `INSERT INTO "Session" (id, "businessId", "userId", "tokenHash", "expiresAt", "createdAt")
       VALUES ($1, $2, $3, $4, now() + $5::interval, now() + $6::interval)`,
      [`s-${n}`, businessId, userId, `hash-${n}`, expires, created],
    );
  await session('expired', '-1 hour', '-5 days');
  await session('expired2', '-3 days', '-40 days');
  await session('toolong', '10 days', '-91 days'); // sliding expiry fine, absolute lifetime over
  await session('live', '10 days', '-5 days');

  const invite = (n: string, expires: string, accepted: string | null) =>
    pg.query(
      `INSERT INTO "Invite" (id, "businessId", email, "tokenHash", "expiresAt", "acceptedAt")
       VALUES ($1, $2, $3, $4, now() + $5::interval, ${accepted ? 'now() + $6::interval' : '$6::text::timestamptz'})`,
      [`i-${n}`, businessId, `${n}@example.test`, `ihash-${n}`, expires, accepted],
    );
  await invite('old-accepted', '-20 days', '-8 days');
  await invite('old-expired', '-8 days', null);
  await invite('recent-expired', '-1 day', null);
  await invite('recent-accepted', '-3 days', '-1 day');
  await invite('pending', '2 days', null);

  // Account email tokens: one live, one expired, one used (still within its lifetime), one expired AND used.
  const token = (n: string, kind: string, expires: string, used: string | null) =>
    pg.query(
      `INSERT INTO "EmailToken" (id, "userId", kind, "tokenHash", "expiresAt", "usedAt")
       VALUES ($1, $2, $3::"EmailTokenKind", $4, now() + $5::interval, ${used ? 'now() + $6::interval' : '$6::text::timestamptz'})`,
      [`t-${n}`, userId, kind, `thash-${n}`, expires, used],
    );
  await token('live-reset', 'RESET', '30 minutes', null);
  await token('expired', 'VERIFY', '-1 hour', null);
  await token('used', 'RESET', '20 minutes', '-5 minutes');
  await token('expired-used', 'VERIFY', '-2 days', '-3 days');

  await pg.query(
    `INSERT INTO "RateLimitBucket" (key, "windowStart", count) VALUES
     ('old', now() - interval '3 days', 4), ('fresh', now() - interval '1 hour', 2)`,
  );
  return { cookie, businessId };
}

const ids = async (table: string) =>
  (await pg.query(`SELECT id FROM "${table}" ORDER BY id`)).rows.map((r) => r.id as string);

describe('cleanup job', () => {
  it('deletes only dead sessions, stale invites and old buckets, and reports counts', async () => {
    await seed();
    const keptSessions = await pg.query(`SELECT count(*)::int AS n FROM "Session"`);
    expect(keptSessions.rows[0].n).toBe(5); // signup session + 4 seeded
    const result = await runCleanup(rootLogger);
    expect(result).toEqual({
      sessions: 3,
      invites: 2,
      emailTokens: 3,
      rateLimitBuckets: 1,
      truncated: false,
    });
    expect(await ids('Invite')).toEqual(['i-pending', 'i-recent-accepted', 'i-recent-expired']);
    const sessions = await ids('Session');
    expect(sessions).toContain('s-live');
    expect(sessions).toHaveLength(2);
    // Explicitly: every ACTIVE session (younger than 90 days, expiry in the future) survived.
    const active = `SELECT count(*)::int AS n FROM "Session" WHERE "expiresAt" > now() AND "createdAt" > now() - interval '90 days'`;
    expect((await pg.query(active)).rows[0].n).toBe(2);
    expect((await pg.query(`SELECT key FROM "RateLimitBucket"`)).rows).toEqual([{ key: 'fresh' }]);
    // Used and expired tokens are gone; the live ones (the unused reset and the signup verification) stay.
    expect(await ids('EmailToken')).toHaveLength(2);
    expect((await pg.query(`SELECT 1 FROM "EmailToken" WHERE id = 't-live-reset'`)).rowCount).toBe(1);
    expect(
      (await pg.query(`SELECT 1 FROM "EmailToken" WHERE "usedAt" IS NOT NULL OR "expiresAt" < now()`)).rowCount,
    ).toBe(0);
    // Idempotent.
    expect(await runCleanup(rootLogger)).toEqual({
      sessions: 0,
      invites: 0,
      emailTokens: 0,
      rateLimitBuckets: 0,
      truncated: false,
    });
  });

  it('keeps waitlist offers and every business row', async () => {
    await seed();
    const before = await count('Business');
    await runCleanup(rootLogger);
    expect(await count('Business')).toBe(before);
  });

  it('works in batches and stops at the time budget (the next run continues)', async () => {
    await seed();
    await pg.query(
      `INSERT INTO "Session" (id, "businessId", "userId", "tokenHash", "expiresAt")
       SELECT 'x' || g, "businessId", "userId", 'xh' || g, now() - interval '1 day'
       FROM "Session" CROSS JOIN generate_series(1, 7) g WHERE id = 's-live'`,
    );
    const first = await runCleanup(rootLogger, { batch: 2 });
    expect(first.sessions).toBe(10);
    expect(await count('Session')).toBe(2);

    await truncateAll(pg);
    await seed();
    let calls = 0;
    const stopped = await runCleanup(rootLogger, {
      budgetMs: 1,
      elapsedMs: () => (calls++ === 0 ? 0 : 5), // budget is gone after the first batch
      batch: 1,
    });
    expect(stopped.truncated).toBe(true);
    expect(stopped.sessions).toBe(1);
    expect(await runCleanup(rootLogger)).toMatchObject({ truncated: false });
  });

  it('a session older than 90 days is rejected by the guard even though its expiry is in the future', async () => {
    const { cookie } = await signup();
    expect((await call(me, '/api/me', { cookie })).status).toBe(200);
    await pg.query(
      `UPDATE "Session" SET "createdAt" = now() - interval '91 days', "expiresAt" = now() + interval '20 days'`,
    );
    expect((await call(me, '/api/me', { cookie })).status).toBe(401);
  });
});

describe('POST /api/jobs/cleanup', () => {
  const secret = () => process.env.CRON_SECRET!;
  const run = (opts: Parameters<typeof call>[2] = {}) =>
    call(cleanupJob, '/api/jobs/cleanup', { method: 'POST', ...opts });

  it('401 without or with a wrong cron secret, and a session cookie is not enough', async () => {
    const { cookie } = await signup();
    expect((await run()).status).toBe(401);
    expect((await run({ headers: { 'x-cron-secret': 'wrong' } })).status).toBe(401);
    expect((await run({ cookie })).status).toBe(401);
  });

  it('400 on unknown query parameters', async () => {
    const res = await run({ query: { all: '1' }, headers: { 'x-cron-secret': secret() } });
    expect(res.status).toBe(400);
  });

  it('200 with counts', async () => {
    await seed();
    const res = await run({ headers: { 'x-cron-secret': secret() } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      sessions: 3,
      invites: 2,
      emailTokens: 3,
      rateLimitBuckets: 1,
      truncated: false,
    });
  });
});
