import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { GET as slugCheck } from '@/app/api/auth/slug-check/route';
import { POST as signupRoute } from '@/app/api/auth/signup/route';
import { GET as me } from '@/app/api/me/route';
import { sha256Hex } from '@/server/services/crypto';
import { sessionService } from '@/server/services/session';
import { call, PASSWORD, signup, signupBody } from './helpers/api';
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

describe('POST /api/auth/signup', () => {
  it('creates business, user, OWNER membership, bookable owner staff and a working session', async () => {
    const { body, res, cookie } = await signup({ slug: 'studio-lina', email: 'Lina@Example.test' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      user: { name: 'Owner', email: 'lina@example.test' },
      business: { slug: 'studio-lina', name: body.businessName, timezone: 'Asia/Beirut' },
      role: 'OWNER',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);

    const set = res.setCookie!;
    expect(set).toMatch(/^maw3ed_session=[A-Za-z0-9_-]{43};/);
    expect(set).toContain('HttpOnly');
    expect(set).toContain('SameSite=Lax');
    expect(set).toContain('Path=/');

    expect(await count('Business')).toBe(1);
    expect(await count('User')).toBe(1);
    const membership = await pg.query('SELECT role FROM "Membership"');
    expect(membership.rows).toEqual([{ role: 'OWNER' }]);
    const staff = await pg.query('SELECT bookable, "displayName", "userId" FROM "StaffMember"');
    expect(staff.rows).toEqual([
      { bookable: true, displayName: 'Owner', userId: res.body!.user.id },
    ]);
    const user = await pg.query('SELECT "passwordHash" FROM "User"');
    expect(user.rows[0].passwordHash).toMatch(/^\$argon2id\$/);

    // Only the sha256 of the token is stored.
    const token = cookie.split('=')[1]!;
    const sessions = await pg.query('SELECT "tokenHash" FROM "Session"');
    expect(sessions.rows).toEqual([{ tokenHash: sha256Hex(token) }]);

    const meRes = await call(me, '/api/me', { cookie });
    expect(meRes.status).toBe(200);
    expect(meRes.body).toEqual(res.body);
  });

  it('is atomic: a failure after the business insert rolls everything back', async () => {
    const first = await signup();
    // Make the LAST insert in the transaction (Session) fail by reusing an existing token hash.
    const taken = sha256Hex(first.cookie.split('=')[1]!);
    const spy = vi.spyOn(sessionService, 'issue').mockReturnValue({
      token: 'x',
      tokenHash: taken,
      expiresAt: new Date(Date.now() + 60_000),
    });
    try {
      const res = await call(signupRoute, '/api/auth/signup', {
        body: signupBody({ slug: 'rolled-back' }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    } finally {
      spy.mockRestore();
    }
    expect(await count('Business')).toBe(1);
    expect(await count('User')).toBe(1);
    expect(await count('Membership')).toBe(1);
    expect(await count('StaffMember')).toBe(1);
    expect(await count('Session')).toBe(1);
    const leaked = await pg.query(`SELECT 1 FROM "Business" WHERE slug = 'rolled-back'`);
    expect(leaked.rowCount).toBe(0);
  });

  it('409 SLUG_TAKEN and EMAIL_TAKEN', async () => {
    const first = await signup();
    const slugDup = await call(signupRoute, '/api/auth/signup', {
      body: signupBody({ slug: first.body.slug }),
    });
    expect(slugDup.status).toBe(409);
    expect(slugDup.body!.error.code).toBe('SLUG_TAKEN');

    const emailDup = await call(signupRoute, '/api/auth/signup', {
      body: signupBody({ email: first.body.email.toUpperCase() }),
    });
    expect(emailDup.status).toBe(409);
    expect(emailDup.body!.error.code).toBe('EMAIL_TAKEN');
    expect(await count('Business')).toBe(1);
  });

  it('two parallel signups with the same slug: one 201, one 409, one business', async () => {
    const slug = 'race-slug';
    const results = await Promise.all([
      call(signupRoute, '/api/auth/signup', { body: signupBody({ slug }) }),
      call(signupRoute, '/api/auth/signup', { body: signupBody({ slug }) }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body!.error.code).toBe('SLUG_TAKEN');
    expect(await count('Business')).toBe(1);
    expect(await count('User')).toBe(1);
  });

  it('400 with fields for invalid payloads and unknown fields', async () => {
    const bad = await call(signupRoute, '/api/auth/signup', {
      body: signupBody({
        email: 'nope',
        password: 'short',
        timezone: 'Mars/Base',
        slug: '-bad-',
        businessName: '',
      }),
    });
    expect(bad.status).toBe(400);
    expect(bad.body!.error.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(bad.body!.error.fields).sort()).toEqual(
      ['businessName', 'email', 'password', 'timezone'].sort(),
    );

    const unknown = await call(signupRoute, '/api/auth/signup', {
      body: { ...signupBody(), role: 'OWNER', businessId: 'x' },
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body!.error.fields).toMatchObject({
      role: 'Unknown field.',
      businessId: 'Unknown field.',
    });

    const slug = await call(signupRoute, '/api/auth/signup', {
      body: signupBody({ slug: '-bad-' }),
    });
    expect(slug.status).toBe(400);
    expect(slug.body!.error.fields.slug).toBeTruthy();

    const longPw = await call(signupRoute, '/api/auth/signup', {
      body: signupBody({ password: 'x'.repeat(129) }),
    });
    expect(longPw.status).toBe(400);
    expect(await count('Business')).toBe(0);
  });

  it('rejects reserved slugs with 400', async () => {
    for (const slug of ['login', 'api', 'admin', '_next']) {
      const res = await call(signupRoute, '/api/auth/signup', { body: signupBody({ slug }) });
      expect(res.status, slug).toBe(400);
      expect(res.body!.error.fields.slug, slug).toBeTruthy();
    }
    expect(await count('Business')).toBe(0);
  });
});

describe('GET /api/auth/slug-check', () => {
  it('reports available, invalid, reserved and taken', async () => {
    await signup({ slug: 'taken-one' });
    const check = (slug: string) => call(slugCheck, '/api/auth/slug-check', { query: { slug } });
    expect((await check('free-slug')).body).toEqual({ available: true });
    expect((await check('taken-one')).body).toEqual({ available: false, reason: 'taken' });
    expect((await check('Taken-One')).body).toEqual({ available: false, reason: 'taken' });
    expect((await check('login')).body).toEqual({ available: false, reason: 'reserved' });
    expect((await check('-x-')).body).toEqual({ available: false, reason: 'invalid' });
    expect((await check('ab')).body).toEqual({ available: false, reason: 'invalid' });
  });

  it('400 on a missing slug or unknown query param', async () => {
    expect((await call(slugCheck, '/api/auth/slug-check')).status).toBe(400);
    expect(
      (await call(slugCheck, '/api/auth/slug-check', { query: { slug: 'abc', x: '1' } })).status,
    ).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with the right password and sets a cookie that works', async () => {
    const { body } = await signup();
    const res = await call(login, '/api/auth/login', {
      body: { email: body.email.toUpperCase(), password: PASSWORD },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'OWNER', user: { email: body.email } });
    expect(res.cookie).toMatch(/^maw3ed_session=/);
    expect((await call(me, '/api/me', { cookie: res.cookie })).status).toBe(200);
    expect(await count('Session')).toBe(2);
  });

  it('wrong password, unknown email and missing user give the identical 401 body', async () => {
    const { body } = await signup();
    const wrongPw = await call(login, '/api/auth/login', {
      body: { email: body.email, password: 'definitely-wrong-1' },
    });
    const noUser = await call(login, '/api/auth/login', {
      body: { email: 'ghost@example.test', password: 'definitely-wrong-1' },
    });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.body).toEqual(noUser.body);
    expect(wrongPw.body!.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrongPw.cookie).toBeUndefined();
    expect(noUser.cookie).toBeUndefined();
  });

  it('a password-less user cannot log in', async () => {
    await pg.query(
      `INSERT INTO "User" (id, email, name, "updatedAt") VALUES ('u_nopw', 'nopw@example.test', 'X', now())`,
    );
    const res = await call(login, '/api/auth/login', {
      body: { email: 'nopw@example.test', password: 'whatever-password' },
    });
    expect(res.status).toBe(401);
  });

  it('uses the most recently created membership when there are several', async () => {
    const a = await signup();
    const b = await signup();
    // Give A's owner a newer membership in B's business.
    await pg.query(
      `INSERT INTO "Membership" (id, "businessId", "userId", role, "createdAt")
       VALUES ('m_new', $1, $2, 'STAFF', now() + interval '1 minute')`,
      [b.info.business.id, a.info.user.id],
    );
    const res = await call(login, '/api/auth/login', {
      body: { email: a.body.email, password: PASSWORD },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ business: { id: b.info.business.id }, role: 'STAFF' });
  });

  it('400 on invalid payload and unknown field', async () => {
    // The box takes an email OR a phone, so unparsable text is not a 400 (it is an unknown account: the same 401).
    const bad = await call(login, '/api/auth/login', { body: { email: 'nope', password: '' } });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body!.error.fields).sort()).toEqual(['password']);
    const neither = await call(login, '/api/auth/login', { body: { password: 'x' } });
    expect(neither.status).toBe(400);
    const both = await call(login, '/api/auth/login', {
      body: { email: 'a@b.test', identifier: 'a@b.test', password: 'x' },
    });
    expect(both.status).toBe(400);
    const garbage = await call(login, '/api/auth/login', {
      body: { identifier: 'nope', password: 'whatever-it-is' },
    });
    expect(garbage.status).toBe(401);
    const unknown = await call(login, '/api/auth/login', {
      body: { email: 'a@b.test', password: 'x', remember: true },
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body!.error.fields.remember).toBe('Unknown field.');
  });

  it('throttles after 5 failures per email in 15 minutes (429), even for the right password', async () => {
    const { body } = await signup();
    for (let i = 0; i < 5; i++) {
      const r = await call(login, '/api/auth/login', {
        body: { email: body.email, password: 'wrong-password-1' },
      });
      expect(r.status).toBe(401);
    }
    const locked = await call(login, '/api/auth/login', {
      body: { email: body.email, password: PASSWORD },
    });
    expect(locked.status).toBe(429);
    expect(locked.body!.error.code).toBe('TOO_MANY_ATTEMPTS');
    // Other emails are unaffected.
    const other = await call(login, '/api/auth/login', {
      body: { email: 'other@example.test', password: 'wrong-password-1' },
    });
    expect(other.status).toBe(401);
  });

  it('a success clears the failure count', async () => {
    const { body } = await signup();
    for (let i = 0; i < 4; i++)
      await call(login, '/api/auth/login', {
        body: { email: body.email, password: 'wrong-password-1' },
      });
    expect(
      (await call(login, '/api/auth/login', { body: { email: body.email, password: PASSWORD } }))
        .status,
    ).toBe(200);
    for (let i = 0; i < 4; i++)
      await call(login, '/api/auth/login', {
        body: { email: body.email, password: 'wrong-password-1' },
      });
    expect(
      (await call(login, '/api/auth/login', { body: { email: body.email, password: PASSWORD } }))
        .status,
    ).toBe(200);
  });
});

describe('GET /api/me and logout', () => {
  it('401 without a cookie, with a garbage cookie, and with an expired session', async () => {
    const { cookie } = await signup();
    for (const c of [undefined, 'maw3ed_session=garbage', 'maw3ed_session=']) {
      const r = await call(me, '/api/me', { cookie: c });
      expect(r.status).toBe(401);
      expect(r.body!.error.code).toBe('UNAUTHENTICATED');
    }
    await pg.query(`UPDATE "Session" SET "expiresAt" = now() - interval '1 second'`);
    expect((await call(me, '/api/me', { cookie })).status).toBe(401);
  });

  it('401 once the membership is removed', async () => {
    const { cookie } = await signup();
    await pg.query('DELETE FROM "Membership"');
    expect((await call(me, '/api/me', { cookie })).status).toBe(401);
  });

  it('slides the expiry at most once an hour and re-issues the cookie', async () => {
    const { cookie } = await signup();
    const row = async () =>
      (await pg.query('SELECT "expiresAt", "lastSeenAt" FROM "Session"')).rows[0];

    const fresh = await call(me, '/api/me', { cookie });
    expect(fresh.setCookie).toBeUndefined();

    await pg.query(
      `UPDATE "Session" SET "lastSeenAt" = now() - interval '2 hours', "expiresAt" = now() + interval '10 days'`,
    );
    const before = await row();
    const slid = await call(me, '/api/me', { cookie });
    expect(slid.status).toBe(200);
    expect(slid.setCookie).toMatch(/^maw3ed_session=.*Max-Age=\d+/);
    const after = await row();
    expect(after.expiresAt.getTime()).toBeGreaterThan(before.expiresAt.getTime() + 19 * 86400_000);
    expect(after.lastSeenAt.getTime()).toBeGreaterThan(before.lastSeenAt.getTime());

    const again = await call(me, '/api/me', { cookie });
    expect(again.setCookie).toBeUndefined();
  });

  it('logout deletes the session row, clears the cookie, and the old cookie stops working', async () => {
    const { cookie } = await signup();
    const out = await call(logout, '/api/auth/logout', { method: 'POST', cookie });
    expect(out.status).toBe(204);
    expect(out.setCookie).toMatch(/^maw3ed_session=;.*Max-Age=0/);
    expect(await count('Session')).toBe(0);
    expect((await call(me, '/api/me', { cookie })).status).toBe(401);
    expect((await call(logout, '/api/auth/logout', { method: 'POST', cookie })).status).toBe(401);
  });

  it('logout only ends the current session', async () => {
    const { body, cookie } = await signup();
    const second = await call(login, '/api/auth/login', {
      body: { email: body.email, password: PASSWORD },
    });
    await call(logout, '/api/auth/logout', { method: 'POST', cookie });
    expect((await call(me, '/api/me', { cookie: second.cookie })).status).toBe(200);
  });
});

describe('throttle identity', () => {
  it('an unknown email gets the same 401 x5 then the same 429 as a known one', async () => {
    const { body } = await signup();
    const run = async (email: string) => {
      const out = [];
      for (let i = 0; i < 6; i++)
        out.push(
          await call(login, '/api/auth/login', { body: { email, password: 'wrong-password-1' } }),
        );
      return out;
    };
    const known = await run(body.email);
    const unknown = await run('nobody@example.test');
    expect(known.map((r) => r.status)).toEqual([401, 401, 401, 401, 401, 429]);
    expect(unknown.map((r) => r.status)).toEqual(known.map((r) => r.status));
    expect(unknown[5]!.body!.error.code).toBe(known[5]!.body!.error.code);
    expect(unknown[5]!.body!.error.message).toBe(known[5]!.body!.error.message);
  });
});

describe('request hardening', () => {
  it('login with text/plain is 415 and creates no session', async () => {
    const { body } = await signup();
    const sessions = await count('Session');
    const res = await call(login, '/api/auth/login', {
      body: { email: body.email, password: PASSWORD },
      headers: { 'content-type': 'text/plain' },
    });
    expect(res.status).toBe(415);
    expect(res.body!.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(await count('Session')).toBe(sessions);
  });

  it('a cross-origin Origin on a session route is 403; same-origin and absent Origin work', async () => {
    const { cookie } = await signup();
    const cross = await call(logout, '/api/auth/logout', {
      method: 'POST',
      cookie,
      headers: { origin: 'https://evil.example' },
    });
    expect(cross.status).toBe(403);
    expect(await count('Session')).toBe(1);
    const same = await call(me, '/api/me', { cookie, headers: { origin: 'http://localhost' } });
    expect(same.status).toBe(200);
    const out = await call(logout, '/api/auth/logout', {
      method: 'POST',
      cookie,
      headers: { origin: 'http://localhost:3000' },
    });
    expect(out.status).toBe(204);
  });

  it('auth responses are no-store', async () => {
    const { body, res, cookie } = await signup();
    expect(res.headers.get('cache-control')).toBe('no-store');
    const l = await call(login, '/api/auth/login', {
      body: { email: body.email, password: PASSWORD },
    });
    expect(l.headers.get('cache-control')).toBe('no-store');
    expect((await call(me, '/api/me', { cookie })).headers.get('cache-control')).toBe('no-store');
    const out = await call(logout, '/api/auth/logout', { method: 'POST', cookie });
    expect(out.headers.get('cache-control')).toBe('no-store');
  });

  it('production cookie is __Host-, Secure, Path=/, with no Domain', async () => {
    const { body } = await signup(); // creates the DB client before NODE_ENV changes
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const l = await call(login, '/api/auth/login', {
        body: { email: body.email, password: PASSWORD },
      });
      expect(l.status).toBe(200);
      expect(l.setCookie).toMatch(/^__Host-maw3ed_session=[A-Za-z0-9_-]{43};/);
      expect(l.setCookie).toContain('Secure');
      expect(l.setCookie).toContain('HttpOnly');
      expect(l.setCookie).toContain('Path=/');
      expect(l.setCookie).not.toContain('Domain');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
