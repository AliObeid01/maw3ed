import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { hash, verify } from '@node-rs/argon2';
import { POST as acceptInvite } from '@/app/api/invites/[token]/accept/route';
import { POST as changePassword } from '@/app/api/auth/change-password/route';
import { POST as createInvite } from '@/app/api/invites/route';
import { POST as forgot } from '@/app/api/auth/forgot-password/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as resetPassword } from '@/app/api/auth/reset-password/route';
import { fakeEmailProvider } from '@/server/providers/email';
import { configurePasswordForTests, type Hasher } from '@/server/services/password';
import { call, PASSWORD, signup } from './helpers/api';
import { newClient, setupSchema, truncateAll } from './helpers/db';

/**
 * F36: a login that passed verifyPassword just before a password reset / change must not be able to leave a
 * session behind. The race is made deterministic with a hook between verifyPassword and the session insert
 * (a hasher that parks the matching verify on a barrier), not with timing.
 */
const NEW_PASSWORD = 'a-brand-new-passphrase';
const LOOPS = 20;

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
  fakeEmailProvider.reset();
});
afterEach(() => configurePasswordForTests());

/** Parks the next successful verify of `plain` until released. */
function parkingHasher() {
  let park: { plain: string; reached: () => void; release: Promise<void> } | undefined;
  const hasher: Hasher = {
    hash: (p) => hash(p),
    async verify(h, p) {
      const ok = await verify(h, p);
      const mine = park && park.plain === p && ok ? park : undefined;
      if (mine) {
        park = undefined;
        mine.reached();
        await mine.release;
      }
      return ok;
    },
  };
  return {
    hasher,
    /** Arm the barrier: `reached` resolves when a verify passed and is parked; call `release` to continue. */
    arm(plain: string) {
      let release!: () => void;
      let reached!: () => void;
      const reachedP = new Promise<void>((r) => (reached = r));
      park = { plain, reached, release: new Promise<void>((r) => (release = r)) };
      return { reached: reachedP, release };
    },
  };
}

const loginCall = (email: string, password: string) =>
  call(login, '/api/auth/login', { body: { email, password } });
const sessionCount = async (email: string) =>
  Number(
    (
      await pg.query(
        `SELECT count(*)::int AS n FROM "Session" s JOIN "User" u ON u.id = s."userId" WHERE u.email = $1`,
        [email],
      )
    ).rows[0].n,
  );

async function resetToken(email: string) {
  fakeEmailProvider.reset();
  expect((await call(forgot, '/api/auth/forgot-password', { body: { email } })).status).toBe(200);
  return /\/reset-password\/([A-Za-z0-9_-]+)/.exec(fakeEmailProvider.calls.at(-1)!.text)![1]!;
}
const resetCall = (token: string) =>
  call(resetPassword, '/api/auth/reset-password', { body: { token, newPassword: NEW_PASSWORD } });
const changeCall = (cookie: string) =>
  call(changePassword, '/api/auth/change-password', {
    body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    cookie,
  });

describe('F36 deterministic: login parked between verifyPassword and the session insert', () => {
  it('reset-password: the old-password login is rejected and leaves no session', async () => {
    const owner = await signup();
    const token = await resetToken(owner.body.email);
    const p = parkingHasher();
    configurePasswordForTests({ hasher: p.hasher });
    const gate = p.arm(PASSWORD);

    const racing = loginCall(owner.body.email, PASSWORD);
    await gate.reached; // verifyPassword already said yes with the OLD password
    expect((await resetCall(token)).status).toBe(200);
    expect(await sessionCount(owner.body.email)).toBe(0);
    gate.release();

    expect((await racing).status).toBe(401);
    expect(await sessionCount(owner.body.email)).toBe(0);
    expect((await loginCall(owner.body.email, NEW_PASSWORD)).status).toBe(200);
  });

  it('change-password: the old-password login is rejected; only the kept session survives', async () => {
    const owner = await signup();
    const p = parkingHasher();
    configurePasswordForTests({ hasher: p.hasher });
    const gate = p.arm(PASSWORD);

    const racing = loginCall(owner.body.email, PASSWORD);
    await gate.reached;
    expect((await changeCall(owner.cookie)).status).toBe(200);
    gate.release();

    expect((await racing).status).toBe(401);
    expect(await sessionCount(owner.body.email)).toBe(1);
  });

  it('invite accept by an existing user: a password changed after the check rejects the accept', async () => {
    const owner = await signup();
    const other = await signup();
    const inv = await call(createInvite, '/api/invites', {
      body: { email: other.body.email, role: 'STAFF' },
      cookie: owner.cookie,
    });
    expect(inv.status).toBe(201);
    const token = (inv.body!.acceptUrl as string).split('/invite/')[1]!;
    const p = parkingHasher();
    configurePasswordForTests({ hasher: p.hasher });
    const gate = p.arm(PASSWORD);

    const racing = call(acceptInvite, `/api/invites/${token}/accept`, {
      body: { name: 'X', password: PASSWORD },
      params: { token },
    });
    await gate.reached;
    expect((await changeCall(other.cookie)).status).toBe(200);
    gate.release();

    expect((await racing).status).toBe(401);
    expect(await sessionCount(other.body.email)).toBe(1); // just the one change-password kept
    const m = await pg.query(
      `SELECT count(*)::int AS n FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u.email = $1`,
      [other.body.email],
    );
    expect(m.rows[0].n).toBe(1); // no membership gained
  });
});

describe('F36 concurrency: never deadlocks, never keeps an old-password session', () => {
  it('a normal login works', async () => {
    const owner = await signup();
    const res = await loginCall(owner.body.email, PASSWORD);
    expect(res.status).toBe(200);
    expect(await sessionCount(owner.body.email)).toBe(2);
  });

  it(`concurrent logins of one user all succeed (x${LOOPS})`, async () => {
    const owner = await signup();
    for (let i = 0; i < LOOPS; i++) {
      const rs = await Promise.all([1, 2, 3, 4].map(() => loginCall(owner.body.email, PASSWORD)));
      expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    }
    expect(await sessionCount(owner.body.email)).toBe(1 + LOOPS * 4);
  }, 120_000);

  it(`concurrent reset + logins: no session survives (x${LOOPS})`, async () => {
    for (let i = 0; i < LOOPS; i++) {
      const owner = await signup();
      const token = await resetToken(owner.body.email);
      const rs = await Promise.all([
        resetCall(token),
        ...[1, 2, 3].map(() => loginCall(owner.body.email, PASSWORD)),
      ]);
      expect(rs[0]!.status).toBe(200);
      for (const r of rs.slice(1)) expect([200, 401]).toContain(r.status);
      expect(await sessionCount(owner.body.email)).toBe(0);
    }
  }, 180_000);

  it(`concurrent change-password + logins: only the kept session survives (x${LOOPS})`, async () => {
    for (let i = 0; i < LOOPS; i++) {
      const owner = await signup();
      const rs = await Promise.all([
        changeCall(owner.cookie),
        ...[1, 2, 3].map(() => loginCall(owner.body.email, PASSWORD)),
      ]);
      expect(rs[0]!.status).toBe(200);
      for (const r of rs.slice(1)) expect([200, 401]).toContain(r.status);
      expect(await sessionCount(owner.body.email)).toBe(1);
    }
  }, 180_000);
});
