import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { POST as activate } from '@/app/api/activation/[token]/route';
import { DELETE as turnOff, POST as giveLogin } from '@/app/api/staff/[id]/login/route';
import { POST as createStaff } from '@/app/api/staff/route';
import { call, signup } from './helpers/api';
import { newClient, setupSchema, truncateAll } from './helpers/db';

/**
 * Lock order of the staff login flows. `issueLink` and `turnOff` lock the staff row first and then the token rows;
 * `activate` must take the staff lock FIRST too (read the token without a lock, lock the staff row, then claim the
 * token), otherwise it holds a token row while waiting for a staff row someone else holds: a deadlock.
 */
let pg: Client;
let holder: Client;
beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  holder = newClient();
  await pg.connect();
  await holder.connect();
});
afterAll(async () => {
  await holder.end();
  await pg.end();
});
beforeEach(async () => {
  await truncateAll(pg);
});

type Owner = Awaited<ReturnType<typeof signup>>;
const tokenOf = (url: string) => url.split('/activate/')[1]!;
const PASSWORD = 'correct-horse-battery';

async function newStaff(owner: Owner, displayName: string) {
  const res = await call(createStaff, '/api/staff', {
    body: { displayName, bookable: false, serviceIds: [] },
    cookie: owner.cookie,
  });
  return res.body!.id as string;
}
const link = (owner: Owner, id: string, phone = '+96170000001') =>
  call(giveLogin, `/api/staff/${id}/login`, { body: { phone }, cookie: owner.cookie, params: { id } });
const off = (owner: Owner, id: string) =>
  call(turnOff, `/api/staff/${id}/login`, { method: 'DELETE', cookie: owner.cookie, params: { id } });
const act = (token: string) =>
  call(activate, `/api/activation/${token}`, { body: { password: PASSWORD }, params: { token } });

async function waitForLockWaiter() {
  for (let i = 0; i < 100; i++) {
    const { rows } = await pg.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE wait_event_type = 'Lock' AND query ILIKE '%StaffMember%' AND pid <> pg_backend_pid()`,
    );
    if (rows[0].n > 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('the activation never waited for the staff lock');
}

describe('activation lock order', () => {
  it('does not deadlock with an owner who holds the staff row and then replaces the link', async () => {
    const owner = await signup();
    const staffId = await newStaff(owner, 'Barber One');
    const token = tokenOf((await link(owner, staffId)).body!.url);

    // The owner's transaction (what turnOff / issueLink do): staff row first...
    await holder.query('BEGIN');
    await holder.query(`SELECT id FROM "StaffMember" WHERE id = $1 FOR UPDATE`, [staffId]);
    const activating = act(token);
    await waitForLockWaiter();
    // ...then the open token rows. With the old order the activation already holds this token row: deadlock.
    let ownerError: unknown;
    try {
      await holder.query(
        `DELETE FROM "ActivationToken" WHERE "staffMemberId" = $1 AND "usedAt" IS NULL`,
        [staffId],
      );
      await holder.query('COMMIT');
    } catch (error) {
      ownerError = error;
      await holder.query('ROLLBACK').catch(() => undefined);
    }
    const res = await activating;
    expect(ownerError, 'the owner transaction was chosen as the deadlock victim').toBeUndefined();
    // The link was replaced under the activation: the barber gets the one "link invalid" answer, never a 5xx.
    expect(res.status).toBe(404);
    expect((await pg.query(`SELECT count(*)::int AS n FROM "Membership" WHERE role = 'PRACTITIONER'`)).rows[0].n).toBe(0);
  });
});

describe('activate against turn-off and reset, many times', () => {
  it('never answers 5xx and always ends in a consistent state', async () => {
    const owner = await signup();
    const statuses: number[] = [];
    for (let round = 0; round < 12; round++) {
      await pg.query('DELETE FROM "RateLimitBucket"');
      const staffId = await newStaff(owner, `Barber ${round}`);
      const first = await link(owner, staffId, '+96170000009');
      const token = tokenOf(first.body!.url);
      const results = await Promise.all([act(token), link(owner, staffId, '+96170000009'), off(owner, staffId)]);
      statuses.push(...results.map((r) => r.status));
      for (const r of results) expect(r.status, `round ${round}: ${JSON.stringify(r.body)}`).toBeLessThan(500);
      // One login per staff member at most, and a membership only while the staff row points at its user.
      const state = (
        await pg.query(
          `SELECT s."userId", (SELECT count(*)::int FROM "Membership" m WHERE m."userId" = s."userId" AND m.role = 'PRACTITIONER') AS memberships
           FROM "StaffMember" s WHERE s.id = $1`,
          [staffId],
        )
      ).rows[0];
      if (state.userId) expect(state.memberships).toBe(1);
      // Free the phone for the next round.
      await off(owner, staffId);
      await pg.query(`DELETE FROM "User" WHERE phone = '+96170000009' AND id NOT IN (SELECT "userId" FROM "StaffMember" WHERE "userId" IS NOT NULL)`);
    }
    expect(statuses.every((s) => s < 500)).toBe(true);
  });
});
