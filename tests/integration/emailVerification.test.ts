import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as resend } from '@/app/api/auth/resend-verification/route';
import { POST as verify } from '@/app/api/auth/verify-email/route';
import { GET as getBusiness, PATCH as patchBusiness } from '@/app/api/business/route';
import { POST as createInvite } from '@/app/api/invites/route';
import { POST as acceptInvite } from '@/app/api/invites/[token]/accept/route';
import { GET as me } from '@/app/api/me/route';
import { fakeEmailProvider, setEmailProviderOverride } from '@/server/providers/email';
import { sha256Hex } from '@/server/services/crypto';
import { call, PASSWORD, signup } from './helpers/api';
import { newClient, setupSchema, truncateAll } from './helpers/db';

// Capture every log line the app writes, to prove no token ever reaches the logs.
const logLines = vi.hoisted(() => [] as string[]);
vi.mock('@/server/http/logger', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/server/http/logger')>();
  const logger = mod.createLogger({
    level: 'trace',
    destination: { write: (line: string) => void logLines.push(line) },
  });
  return { ...mod, rootLogger: logger, childLogger: (b: Parameters<typeof mod.childLogger>[0]) => logger.child(b) };
});

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
  logLines.length = 0;
});

const tokenIn = (text: string) => /\/verify-email\/([A-Za-z0-9_-]+)/.exec(text)![1]!;
const lastVerifyToken = () => tokenIn(fakeEmailProvider.calls.at(-1)!.text);
const verifyCall = (token: unknown) => call(verify, '/api/auth/verify-email', { body: { token } });
const isVerified = async (cookie: string) =>
  (await call(me, '/api/me', { cookie })).body!.user.emailVerified as boolean;
const dbVerified = async (email: string) =>
  (await pg.query('SELECT "emailVerifiedAt" FROM "User" WHERE email = $1', [email])).rows[0]
    .emailVerifiedAt as Date | null;

describe('signup', () => {
  it('creates an UNVERIFIED user and sends exactly one verification email', async () => {
    const before = Date.now();
    const { body, cookie, res } = await signup({ verified: false });
    expect(res.body!.user.emailVerified).toBe(false);
    expect(await isVerified(cookie)).toBe(false);
    expect(await dbVerified(body.email)).toBeNull();

    expect(fakeEmailProvider.calls).toHaveLength(1);
    const mail = fakeEmailProvider.calls[0]!;
    expect(mail.to).toBe(body.email);
    const token = tokenIn(mail.text);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mail.text).toContain(`http://localhost:3000/verify-email/${token}`);
    expect(mail.text).toMatch(/24 hours/);
    expect(mail.html).toContain('dir="ltr"');
    expect(mail.html).toContain(`http://localhost:3000/verify-email/${token}`);
    expect(mail.text + mail.html).not.toContain(PASSWORD);

    const rows = (await pg.query('SELECT kind, "tokenHash", "expiresAt", "usedAt" FROM "EmailToken"'))
      .rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'VERIFY', tokenHash: sha256Hex(token), usedAt: null });
    expect(JSON.stringify(rows)).not.toContain(token);
    const hours = ((rows[0].expiresAt as Date).getTime() - before) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThan(24.1);
  });

  it('does not fail when the email cannot be sent: the account works, the failure is logged', async () => {
    process.env.EMAIL_PROVIDER = 'stub';
    setEmailProviderOverride({
      send: async () => {
        throw new Error('provider down');
      },
    });
    try {
      const { res, cookie } = await signup({ verified: false });
      expect(res.status).toBe(201);
      expect((await call(me, '/api/me', { cookie })).status).toBe(200);
    } finally {
      setEmailProviderOverride(undefined);
      process.env.EMAIL_PROVIDER = 'fake';
    }
    expect(logLines.join('')).toContain('verification email failed');
  });
});

describe('POST /api/auth/verify-email', () => {
  it('verifies once; the replay of the same token fails', async () => {
    const { cookie, body } = await signup({ verified: false });
    const token = lastVerifyToken();

    const ok = await verifyCall(token);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true });
    expect(await isVerified(cookie)).toBe(true);
    expect(await dbVerified(body.email)).not.toBeNull();

    const replay = await verifyCall(token);
    expect(replay.status).toBe(410);
    expect(replay.body!.error.code).toBe('LINK_INVALID');
  });

  it('two parallel confirmations: exactly one wins', async () => {
    await signup({ verified: false });
    const token = lastVerifyToken();
    const results = await Promise.all([verifyCall(token), verifyCall(token), verifyCall(token)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 410, 410]);
  });

  it('an expired token fails and does not verify', async () => {
    const { cookie } = await signup({ verified: false });
    const token = lastVerifyToken();
    await pg.query(`UPDATE "EmailToken" SET "expiresAt" = now() - interval '1 second'`);
    const res = await verifyCall(token);
    expect(res.status).toBe(410);
    expect(res.body!.error.code).toBe('LINK_INVALID');
    expect(await isVerified(cookie)).toBe(false);
  });

  it('a wrong or forged token fails the same way as an expired one', async () => {
    const { cookie } = await signup({ verified: false });
    const real = lastVerifyToken();
    const forged = real.slice(0, -1) + (real.endsWith('A') ? 'B' : 'A');
    for (const bad of [forged, 'x'.repeat(43), sha256Hex(real)]) {
      const res = await verifyCall(bad);
      expect(res.status).toBe(410);
      expect(res.body!.error.code).toBe('LINK_INVALID');
    }
    expect(await isVerified(cookie)).toBe(false);
  });

  it("one user's token cannot verify someone else", async () => {
    const a = await signup({ verified: false });
    const tokenA = lastVerifyToken();
    const b = await signup({ verified: false });
    const tokenB = lastVerifyToken();
    expect((await verifyCall(tokenA)).status).toBe(200);
    expect(await isVerified(a.cookie)).toBe(true);
    expect(await isVerified(b.cookie)).toBe(false);
    expect((await verifyCall(tokenB)).status).toBe(200);
    expect(await isVerified(b.cookie)).toBe(true);
  });

  it('a RESET token is not accepted as a verify token', async () => {
    const { body } = await signup({ verified: false });
    await pg.query(
      `INSERT INTO "EmailToken" (id, "userId", kind, "tokenHash", "expiresAt")
       SELECT 'reset-1', id, 'RESET', $2, now() + interval '1 hour' FROM "User" WHERE email = $1`,
      [body.email, sha256Hex('reset-token-value')],
    );
    expect((await verifyCall('reset-token-value')).status).toBe(410);
    expect(await dbVerified(body.email)).toBeNull();
  });

  it('400 with fields on a missing token or an unknown field', async () => {
    const empty = await call(verify, '/api/auth/verify-email', { body: {} });
    expect(empty.status).toBe(400);
    expect(empty.body!.error.fields).toHaveProperty('token');
    const extra = await call(verify, '/api/auth/verify-email', { body: { token: 'a', admin: true } });
    expect(extra.status).toBe(400);
    expect(extra.body!.error.fields).toHaveProperty('admin');
  });

  it('never writes the token to the logs', async () => {
    await signup({ verified: false });
    const token = lastVerifyToken();
    await verifyCall(token);
    await verifyCall(token);
    const logs = logLines.join('');
    expect(logs).toContain('email verified');
    expect(logs).not.toContain(token);
    expect(logs).not.toContain(sha256Hex(token));
    expect(logs).not.toContain(PASSWORD);
  });
});

describe('POST /api/auth/resend-verification', () => {
  it('needs a session', async () => {
    const res = await call(resend, '/api/auth/resend-verification', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('sends a fresh email and invalidates the older unused token', async () => {
    const { cookie } = await signup({ verified: false });
    const first = lastVerifyToken();
    const res = await call(resend, '/api/auth/resend-verification', { method: 'POST', cookie });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, alreadyVerified: false });
    expect(fakeEmailProvider.calls).toHaveLength(2);
    const second = lastVerifyToken();
    expect(second).not.toBe(first);
    expect((await pg.query(`SELECT 1 FROM "EmailToken" WHERE "usedAt" IS NULL`)).rowCount).toBe(1);
    expect((await verifyCall(first)).status).toBe(410);
    expect((await verifyCall(second)).status).toBe(200);
  });

  it('sends nothing when already verified', async () => {
    const { cookie } = await signup({ verified: false });
    await verifyCall(lastVerifyToken());
    fakeEmailProvider.reset();
    const res = await call(resend, '/api/auth/resend-verification', { method: 'POST', cookie });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, alreadyVerified: true });
    expect(fakeEmailProvider.calls).toHaveLength(0);
  });

  it('is limited to 3 per hour per user (429 RATE_LIMITED with Retry-After)', async () => {
    const { cookie } = await signup({ verified: false });
    const other = await signup({ verified: false });
    fakeEmailProvider.reset();
    for (let i = 0; i < 3; i++)
      expect((await call(resend, '/api/auth/resend-verification', { method: 'POST', cookie })).status).toBe(200);
    const limited = await call(resend, '/api/auth/resend-verification', { method: 'POST', cookie });
    expect(limited.status).toBe(429);
    expect(limited.body!.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(fakeEmailProvider.calls).toHaveLength(3);
    // Another user is not affected.
    const fine = await call(resend, '/api/auth/resend-verification', {
      method: 'POST',
      cookie: other.cookie,
    });
    expect(fine.status).toBe(200);
  });

  it('503 when the email cannot be sent, and says so', async () => {
    const { cookie } = await signup({ verified: false });
    process.env.EMAIL_PROVIDER = 'stub';
    setEmailProviderOverride({
      send: async () => {
        throw new Error('down');
      },
    });
    try {
      const res = await call(resend, '/api/auth/resend-verification', { method: 'POST', cookie });
      expect(res.status).toBe(503);
    } finally {
      setEmailProviderOverride(undefined);
      process.env.EMAIL_PROVIDER = 'fake';
    }
  });
});

describe('soft verification gates (service layer)', () => {
  it('an unverified owner can log in and use the app', async () => {
    const { body } = await signup({ verified: false });
    const res = await call(login, '/api/auth/login', {
      body: { email: body.email, password: PASSWORD },
    });
    expect(res.status).toBe(200);
    expect(res.body!.user.emailVerified).toBe(false);
    expect((await call(getBusiness, '/api/business', { cookie: res.cookie })).status).toBe(200);
  });

  it('an unverified owner cannot invite staff: 409 EMAIL_NOT_VERIFIED, nothing written or sent', async () => {
    const { cookie } = await signup({ verified: false });
    fakeEmailProvider.reset();
    const res = await call(createInvite, '/api/invites', {
      body: { email: 'karim@example.test', role: 'STAFF' },
      cookie,
    });
    expect(res.status).toBe(409);
    expect(res.body!.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(res.body!.error.message).toMatch(/verify your email/i);
    expect((await pg.query('SELECT 1 FROM "Invite"')).rowCount).toBe(0);
    expect(fakeEmailProvider.calls).toHaveLength(0);
  });

  it('an unverified owner cannot list the business in the directory, but may unlist', async () => {
    const { cookie } = await signup({ verified: false });
    const res = await call(patchBusiness, '/api/business', {
      method: 'PATCH',
      body: { listed: true },
      cookie,
    });
    expect(res.status).toBe(409);
    expect(res.body!.error.code).toBe('EMAIL_NOT_VERIFIED');
    const off = await call(patchBusiness, '/api/business', {
      method: 'PATCH',
      body: { listed: false },
      cookie,
    });
    expect(off.status).toBe(200);
    // Other edits are not blocked.
    const rename = await call(patchBusiness, '/api/business', {
      method: 'PATCH',
      body: { name: 'Renamed' },
      cookie,
    });
    expect(rename.status).toBe(200);
  });

  it('after verifying, the same owner is no longer blocked by verification', async () => {
    const { cookie } = await signup({ verified: false });
    await verifyCall(lastVerifyToken());
    fakeEmailProvider.reset();
    const inviteRes = await call(createInvite, '/api/invites', {
      body: { email: 'karim@example.test', role: 'STAFF' },
      cookie,
    });
    expect(inviteRes.status).toBe(201);
    // Listing now fails on readiness (no services yet), not on verification.
    const list = await call(patchBusiness, '/api/business', {
      method: 'PATCH',
      body: { listed: true },
      cookie,
    });
    expect(list.status).toBe(409);
    expect(list.body!.error.code).toBe('NOT_READY');
  });

  it('a verified owner never meets the gate (verified at signup time by the migration backfill)', async () => {
    const { cookie, body } = await signup({ verified: false });
    await pg.query(`UPDATE "User" SET "emailVerifiedAt" = now() WHERE email = $1`, [body.email]);
    const res = await call(createInvite, '/api/invites', {
      body: { email: 'karim@example.test', role: 'STAFF' },
      cookie,
    });
    expect(res.status).toBe(201);
  });
});

describe('accepting a staff invite verifies that address', () => {
  async function inviteBy(ownerCookie: string, email: string) {
    await pg.query(`UPDATE "User" SET "emailVerifiedAt" = now()`); // owner verified so they may invite
    const res = await call(createInvite, '/api/invites', {
      body: { email, role: 'STAFF' },
      cookie: ownerCookie,
    });
    expect(res.status).toBe(201);
    return res.body!.acceptUrl.split('/invite/')[1] as string;
  }

  it('a new invitee is created verified and never needs the banner', async () => {
    const { cookie } = await signup({ verified: false });
    const token = await inviteBy(cookie, 'rana@example.test');
    const res = await call(acceptInvite, `/api/invites/${token}/accept`, {
      body: { name: 'Rana', password: PASSWORD },
      params: { token },
    });
    expect(res.status).toBe(200);
    expect(res.body!.user.emailVerified).toBe(true);
    expect(await dbVerified('rana@example.test')).not.toBeNull();
    // No verification email was queued for them.
    expect(
      (await pg.query(`SELECT 1 FROM "EmailToken" t JOIN "User" u ON u.id = t."userId" WHERE u.email = 'rana@example.test'`)).rowCount,
    ).toBe(0);
  });

  it('an existing UNVERIFIED account that accepts (with its password) becomes verified', async () => {
    const { cookie } = await signup({ verified: false });
    const other = await signup({ verified: false }); // second business, owner NOT verified
    const token = await inviteBy(cookie, other.body.email);
    // inviteBy verified everyone; make the invitee unverified again to test the transition.
    await pg.query(`UPDATE "User" SET "emailVerifiedAt" = NULL WHERE email = $1`, [other.body.email]);
    expect(await dbVerified(other.body.email)).toBeNull();
    const res = await call(acceptInvite, `/api/invites/${token}/accept`, {
      body: { name: 'Owner', password: PASSWORD },
      params: { token },
    });
    expect(res.status).toBe(200);
    expect(await dbVerified(other.body.email)).not.toBeNull();
  });
});
