import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as createInvite } from '@/app/api/invites/route';
import { POST as acceptInvite } from '@/app/api/invites/[token]/accept/route';
import { GET as previewInvite } from '@/app/api/invites/[token]/route';
import { GET as me } from '@/app/api/me/route';
import { fakeEmailProvider, setEmailProviderOverride } from '@/server/providers/email';
import { sha256Hex } from '@/server/services/crypto';
import { call, PASSWORD, signup } from './helpers/api';
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
  fakeEmailProvider.reset();
});

const tokenOf = (acceptUrl: string) => acceptUrl.split('/invite/')[1]!;

async function invite(cookie: string, email = 'karim@example.test') {
  const res = await call(createInvite, '/api/invites', { body: { email, role: 'STAFF' }, cookie });
  expect(res.status).toBe(201);
  return { res, token: tokenOf(res.body!.acceptUrl) };
}

const accept = (token: string, body: unknown) =>
  call(acceptInvite, `/api/invites/${token}/accept`, { body, params: { token } });
const preview = (token: string) =>
  call(previewInvite, `/api/invites/${token}`, { params: { token } });

describe('POST /api/invites', () => {
  it('owner invites: stores only the hash, 72h expiry, sends one email, returns acceptUrl (fake provider)', async () => {
    const { cookie, info } = await signup({ businessName: 'Studio Nour' });
    const before = Date.now();
    const { res, token } = await invite(cookie, 'Karim@Example.test');

    expect(res.body).toMatchObject({ email: 'karim@example.test', role: 'STAFF' });
    expect(res.body!.acceptUrl).toBe(`http://localhost:3000/invite/${token}`);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const hours = (new Date(res.body!.expiresAt).getTime() - before) / 3600_000;
    expect(hours).toBeGreaterThan(71.9);
    expect(hours).toBeLessThan(72.1);

    const rows = (await pg.query('SELECT "tokenHash", "businessId", email FROM "Invite"')).rows;
    expect(rows).toEqual([
      { tokenHash: sha256Hex(token), businessId: info.business.id, email: 'karim@example.test' },
    ]);
    expect(JSON.stringify(rows)).not.toContain(token);

    expect(fakeEmailProvider.calls).toHaveLength(1);
    const mail = fakeEmailProvider.calls[0]!;
    expect(mail.to).toBe('karim@example.test');
    expect(mail.text).toContain(`/invite/${token}`);
    expect(mail.text).toContain('Studio Nour');
    expect(mail.idempotencyKey).toBe(`invite:${res.body!.id}`);
  });

  it('withholds acceptUrl when the provider is not the fake (stub real provider)', async () => {
    const { cookie } = await signup();
    const sent: string[] = [];
    setEmailProviderOverride({
      send: async (m) => {
        sent.push(m.to);
        return { providerMessageId: 'stub-1' };
      },
    });
    process.env.EMAIL_PROVIDER = 'stub';
    try {
      const res = await call(createInvite, '/api/invites', {
        body: { email: 'k@example.test', role: 'STAFF' },
        cookie,
      });
      expect(res.status).toBe(201);
      expect(res.body).not.toHaveProperty('acceptUrl');
      expect(JSON.stringify(res.body)).not.toContain('/invite/');
      expect(sent).toEqual(['k@example.test']);
      expect(fakeEmailProvider.calls).toHaveLength(0);
    } finally {
      setEmailProviderOverride(undefined);
      process.env.EMAIL_PROVIDER = 'fake';
    }
  });

  it('fails closed in production with the fake provider: no invite row, no acceptUrl', async () => {
    const { cookie } = await signup(); // creates the DB client before NODE_ENV changes
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const res = await call(createInvite, '/api/invites', {
        body: { email: 'k@example.test', role: 'STAFF' },
        cookie: cookie.replace('maw3ed_session', '__Host-maw3ed_session'),
      });
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('/invite/');
    } finally {
      vi.unstubAllEnvs();
    }
    expect((await pg.query('SELECT 1 FROM "Invite"')).rowCount).toBe(0);
    expect(fakeEmailProvider.calls).toHaveLength(0);
  });

  it('re-inviting an email replaces the previous open invite', async () => {
    const { cookie } = await signup();
    const first = await invite(cookie);
    const second = await invite(cookie);
    expect((await pg.query('SELECT 1 FROM "Invite"')).rowCount).toBe(1);
    expect((await preview(first.token)).status).toBe(404);
    expect((await preview(second.token)).status).toBe(200);
    expect(fakeEmailProvider.calls).toHaveLength(2);
  });

  it('401 without a session, 400 for bad payloads, 409 for an existing member', async () => {
    const { cookie, body } = await signup();
    expect(
      (await call(createInvite, '/api/invites', { body: { email: 'a@b.test', role: 'STAFF' } }))
        .status,
    ).toBe(401);
    const bad = await call(createInvite, '/api/invites', {
      body: { email: 'nope', role: 'OWNER' },
      cookie,
    });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body!.error.fields).sort()).toEqual(['email', 'role']);
    const unknown = await call(createInvite, '/api/invites', {
      body: { email: 'a@b.test', role: 'STAFF', businessId: 'other' },
      cookie,
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body!.error.fields.businessId).toBe('Unknown field.');
    const self = await call(createInvite, '/api/invites', {
      body: { email: body.email, role: 'STAFF' },
      cookie,
    });
    expect(self.status).toBe(409);
    expect(self.body!.error.code).toBe('ALREADY_MEMBER');
  });
});

describe('GET /api/invites/{token}', () => {
  it('previews a valid invite without the token hash', async () => {
    const { cookie } = await signup({ businessName: 'Studio Nour' });
    const { token } = await invite(cookie);
    const res = await preview(token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      businessName: 'Studio Nour',
      email: 'karim@example.test',
      role: 'STAFF',
    });
    expect(res.body!.expiresAt).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/tokenHash|businessId/);
  });

  it('404 (identical body) for unknown, expired and used tokens', async () => {
    const { cookie } = await signup();
    const { token } = await invite(cookie);
    const unknown = await preview('x'.repeat(43));
    expect(unknown.status).toBe(404);

    await pg.query(`UPDATE "Invite" SET "expiresAt" = now() - interval '1 second'`);
    const expired = await preview(token);
    expect(expired.status).toBe(404);
    expect(expired.body).toEqual(unknown.body);

    await pg.query(
      `UPDATE "Invite" SET "expiresAt" = now() + interval '1 day', "acceptedAt" = now()`,
    );
    const used = await preview(token);
    expect(used.status).toBe(404);
    expect(used.body).toEqual(unknown.body);
  });
});

describe('POST /api/invites/{token}/accept', () => {
  it('creates the user, STAFF membership, non-bookable staff member and a working session', async () => {
    const { cookie: ownerCookie, info } = await signup();
    const { token } = await invite(ownerCookie);
    const res = await accept(token, { name: 'Karim', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      user: { name: 'Karim', email: 'karim@example.test' },
      business: { id: info.business.id },
      role: 'STAFF',
    });
    expect(res.cookie).toMatch(/^maw3ed_session=/);

    const staff = await pg.query(
      `SELECT "displayName", bookable FROM "StaffMember" WHERE "userId" = $1`,
      [res.body!.user.id],
    );
    expect(staff.rows).toEqual([{ displayName: 'Karim', bookable: false }]);
    const membership = await pg.query(`SELECT role FROM "Membership" WHERE "userId" = $1`, [
      res.body!.user.id,
    ]);
    expect(membership.rows).toEqual([{ role: 'STAFF' }]);
    expect((await pg.query('SELECT "acceptedAt" FROM "Invite"')).rows[0].acceptedAt).not.toBeNull();

    expect((await call(me, '/api/me', { cookie: res.cookie })).body).toMatchObject({
      role: 'STAFF',
    });
  });

  it('is single use: a second accept is 404', async () => {
    const { cookie } = await signup();
    const { token } = await invite(cookie);
    expect((await accept(token, { name: 'Karim', password: PASSWORD })).status).toBe(200);
    const again = await accept(token, { name: 'Karim', password: PASSWORD });
    expect(again.status).toBe(404);
  });

  it('two PARALLEL accepts: exactly one 200, one user, one membership, one staff member', async () => {
    const { cookie } = await signup();
    const { token } = await invite(cookie);
    const results = await Promise.all([
      accept(token, { name: 'Karim', password: PASSWORD }),
      accept(token, { name: 'Karim', password: PASSWORD }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
    expect(
      (await pg.query(`SELECT 1 FROM "User" WHERE email = 'karim@example.test'`)).rowCount,
    ).toBe(1);
    expect((await pg.query(`SELECT 1 FROM "Membership" WHERE role = 'STAFF'`)).rowCount).toBe(1);
    expect((await pg.query(`SELECT 1 FROM "StaffMember" WHERE bookable = false`)).rowCount).toBe(1);
    // owner session + exactly one staff session
    expect((await pg.query('SELECT 1 FROM "Session"')).rowCount).toBe(2);
  });

  it('404 for unknown and expired tokens', async () => {
    const { cookie } = await signup();
    expect((await accept('x'.repeat(43), { name: 'K', password: PASSWORD })).status).toBe(404);
    const { token } = await invite(cookie);
    await pg.query(`UPDATE "Invite" SET "expiresAt" = now() - interval '1 second'`);
    expect((await accept(token, { name: 'K', password: PASSWORD })).status).toBe(404);
    expect(
      (await pg.query(`SELECT 1 FROM "User" WHERE email = 'karim@example.test'`)).rowCount,
    ).toBe(0);
  });

  it('400 for a short password (new user), bad payload and unknown fields', async () => {
    const { cookie } = await signup();
    const { token } = await invite(cookie);
    const short = await accept(token, { name: 'K', password: 'short' });
    expect(short.status).toBe(400);
    expect(short.body!.error.fields.password).toBeTruthy();
    const bad = await accept(token, { name: '', password: '' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body!.error.fields).sort()).toEqual(['name', 'password']);
    const unknown = await accept(token, { name: 'K', password: PASSWORD, role: 'OWNER' });
    expect(unknown.status).toBe(400);
    expect(unknown.body!.error.fields.role).toBe('Unknown field.');
    // The invite is still usable after the failures.
    expect((await accept(token, { name: 'K', password: PASSWORD })).status).toBe(200);
  });

  it('existing user: requires their current password and just adds a membership', async () => {
    const owner = await signup();
    const other = await signup({ email: 'karim@example.test', ownerName: 'Karim Existing' });
    const { token } = await invite(owner.cookie, 'karim@example.test');

    const wrong = await accept(token, { name: 'Karim', password: 'not-the-password-1' });
    expect(wrong.status).toBe(401);
    expect(wrong.body!.error.code).toBe('INVALID_CREDENTIALS');
    expect((await preview(token)).status).toBe(200);

    const ok = await accept(token, { name: 'ignored', password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      user: { id: other.info.user.id, name: 'Karim Existing' },
      business: { id: owner.info.business.id },
      role: 'STAFF',
    });
    expect(
      (await pg.query(`SELECT 1 FROM "User" WHERE email = 'karim@example.test'`)).rowCount,
    ).toBe(1);
    expect(
      (await pg.query(`SELECT 1 FROM "Membership" WHERE "userId" = $1`, [other.info.user.id]))
        .rowCount,
    ).toBe(2);
  });
});

describe('role enforcement', () => {
  it('STAFF cannot create invites (403); an accepted STAFF can log in and is blocked from owner routes', async () => {
    const owner = await signup();
    const { token } = await invite(owner.cookie);
    const joined = await accept(token, { name: 'Karim', password: PASSWORD });

    const forbidden = await call(createInvite, '/api/invites', {
      body: { email: 'another@example.test', role: 'STAFF' },
      cookie: joined.cookie,
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body!.error.code).toBe('FORBIDDEN');
    expect(fakeEmailProvider.calls).toHaveLength(1);

    const relog = await call(login, '/api/auth/login', {
      body: { email: 'karim@example.test', password: PASSWORD },
    });
    expect(relog.status).toBe(200);
    expect(relog.body).toMatchObject({ role: 'STAFF' });
    const again = await call(createInvite, '/api/invites', {
      body: { email: 'another@example.test', role: 'STAFF' },
      cookie: relog.cookie,
    });
    expect(again.status).toBe(403);
    expect(
      (await pg.query('SELECT 1 FROM "Invite" WHERE email = $1', ['another@example.test']))
        .rowCount,
    ).toBe(0);
  });
});

describe('existing-user accept: concurrency and throttle', () => {
  it('two PARALLEL accepts by an existing user: exactly one succeeds, one membership', async () => {
    const owner = await signup();
    const other = await signup({ email: 'karim@example.test' });
    const { token } = await invite(owner.cookie, 'karim@example.test');
    const results = await Promise.all([
      accept(token, { name: 'K', password: PASSWORD }),
      accept(token, { name: 'K', password: PASSWORD }),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(
      results.filter((r) => r.status !== 200).every((r) => [404, 409].includes(r.status)),
    ).toBe(true);
    const rows = await pg.query(
      'SELECT 1 FROM "Membership" WHERE "userId" = $1 AND "businessId" = $2',
      [other.info.user.id, owner.info.business.id],
    );
    expect(rows.rowCount).toBe(1);
  });

  it('shares the login failure budget: accept failures lock login, and the reverse', async () => {
    const owner = await signup();
    const other = await signup({ email: 'karim@example.test' });
    const { token } = await invite(owner.cookie, 'karim@example.test');
    for (let i = 0; i < 5; i++) {
      expect((await accept(token, { name: 'K', password: 'wrong-password-1' })).status).toBe(401);
    }
    expect((await accept(token, { name: 'K', password: PASSWORD })).status).toBe(429);
    const locked = await call(login, '/api/auth/login', {
      body: { email: other.body.email, password: PASSWORD },
    });
    expect(locked.status).toBe(429);

    await pg.query('TRUNCATE "RateLimitBucket"');
    for (let i = 0; i < 5; i++)
      await call(login, '/api/auth/login', {
        body: { email: other.body.email, password: 'wrong-password-1' },
      });
    expect((await accept(token, { name: 'K', password: PASSWORD })).status).toBe(429);
  });
});
