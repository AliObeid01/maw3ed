import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { POST as changePassword } from '@/app/api/auth/change-password/route';
import { POST as forgot } from '@/app/api/auth/forgot-password/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as resetPassword } from '@/app/api/auth/reset-password/route';
import { GET as me } from '@/app/api/me/route';
import { fakeEmailProvider, setEmailProviderOverride } from '@/server/providers/email';
import { emailTokenRepo } from '@/server/repositories/emailToken.repo';
import { userRepo } from '@/server/repositories/user.repo';
import { sha256Hex } from '@/server/services/crypto';
import { call, PASSWORD, signup } from './helpers/api';
import { newClient, setupSchema, truncateAll } from './helpers/db';

// Capture every log line the app writes, to prove no token or password ever reaches the logs.
const logLines = vi.hoisted(() => [] as string[]);
vi.mock('@/server/http/logger', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/server/http/logger')>();
  const logger = mod.createLogger({
    level: 'trace',
    destination: { write: (line: string) => void logLines.push(line) },
  });
  return {
    ...mod,
    rootLogger: logger,
    childLogger: (b: Parameters<typeof mod.childLogger>[0]) => logger.child(b),
  };
});

// Deferred work (what runs after the response) can be held back to prove the response path does none of it.
const deferral = vi.hoisted(() => ({ hold: false, queue: [] as Array<() => Promise<void>> }));
vi.mock('@/server/http/afterResponse', () => ({
  afterResponse: async (task: () => Promise<void>) => {
    if (deferral.hold) deferral.queue.push(task);
    else await task();
  },
}));

const NEW_PASSWORD = 'a-brand-new-passphrase';

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
  deferral.hold = false;
  deferral.queue.length = 0;
});

const forgotCall = (email: string, headers?: Record<string, string>) =>
  call(forgot, '/api/auth/forgot-password', { body: { email }, headers });
const resetCall = (token: string, newPassword = NEW_PASSWORD) =>
  call(resetPassword, '/api/auth/reset-password', { body: { token, newPassword } });
const loginCall = (email: string, password: string) =>
  call(login, '/api/auth/login', { body: { email, password } });
const meStatus = async (cookie: string) => (await call(me, '/api/me', { cookie })).status;
const resetTokenIn = (text: string) => /\/reset-password\/([A-Za-z0-9_-]+)/.exec(text)![1]!;

/** A verified owner who asked for a reset; returns the emailed token. */
async function requestReset(over: Record<string, unknown> = {}) {
  const owner = await signup(over);
  fakeEmailProvider.reset();
  const res = await forgotCall(owner.body.email);
  expect(res.status).toBe(200);
  const token = resetTokenIn(fakeEmailProvider.calls.at(-1)!.text);
  return { ...owner, token };
}

describe('POST /api/auth/forgot-password', () => {
  it('answers identically for a known and an unknown email, and mails only the known one', async () => {
    const { body } = await signup();
    fakeEmailProvider.reset();

    const known = await forgotCall(body.email);
    expect(fakeEmailProvider.calls).toHaveLength(1);
    fakeEmailProvider.reset();
    const unknown = await forgotCall('nobody-here@example.test');

    expect(unknown.status).toBe(known.status);
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    expect(unknown.body).toEqual({ ok: true });
    expect([...unknown.headers.keys()].filter((h) => h !== 'x-request-id').sort()).toEqual(
      [...known.headers.keys()].filter((h) => h !== 'x-request-id').sort(),
    );
    expect(fakeEmailProvider.calls).toHaveLength(0);
    expect((await pg.query(`SELECT 1 FROM "EmailToken" WHERE kind = 'RESET'`)).rowCount).toBe(1);
  });

  it('the reset email: link from APP_URL, 1 hour, hash only in the database, no password anywhere', async () => {
    const { body } = await signup();
    fakeEmailProvider.reset();
    const before = Date.now();
    await forgotCall(body.email.toUpperCase());
    expect(fakeEmailProvider.calls).toHaveLength(1);
    const mail = fakeEmailProvider.calls[0]!;
    expect(mail.to).toBe(body.email);
    const token = resetTokenIn(mail.text);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mail.text).toContain(`http://localhost:3000/reset-password/${token}`);
    expect(mail.html).toContain('dir="ltr"');
    expect(mail.text).toMatch(/1 hour/);
    expect(mail.text + mail.html).not.toContain(PASSWORD);

    const row = (
      await pg.query(`SELECT "tokenHash", "expiresAt", "usedAt" FROM "EmailToken" WHERE kind = 'RESET'`)
    ).rows[0];
    expect(row.tokenHash).toBe(sha256Hex(token));
    expect(row.usedAt).toBeNull();
    const minutes = ((row.expiresAt as Date).getTime() - before) / 60_000;
    expect(minutes).toBeGreaterThan(59);
    expect(minutes).toBeLessThan(61);
  });

  it('a provider failure still answers the same generic 200', async () => {
    const { body } = await signup();
    process.env.EMAIL_PROVIDER = 'stub';
    setEmailProviderOverride({
      send: async () => {
        throw new Error('down');
      },
    });
    try {
      const res = await forgotCall(body.email);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    } finally {
      setEmailProviderOverride(undefined);
      process.env.EMAIL_PROVIDER = 'fake';
    }
    expect(logLines.join('')).toContain('password reset email failed');
  });

  it('the response path does NOTHING but the rate-limit count: lookup, token, render and send all run after it, alike for known and unknown emails', async () => {
    const { body } = await signup();
    fakeEmailProvider.reset();
    const find = vi.spyOn(userRepo, 'findByEmail');
    const issue = vi.spyOn(emailTokenRepo, 'issue');
    try {
      for (const email of [body.email, 'ghost@example.test']) {
        find.mockClear();
        issue.mockClear();
        const mailsBefore = fakeEmailProvider.calls.length;
        deferral.hold = true;
        const res = await forgotCall(email);
        // The HTTP response has resolved: nothing else has happened yet.
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
        expect(find).not.toHaveBeenCalled();
        expect(issue).not.toHaveBeenCalled();
        expect(fakeEmailProvider.calls).toHaveLength(mailsBefore);
        expect(deferral.queue).toHaveLength(1);
        // ...and then the deferred work runs, with the same first step for both.
        deferral.hold = false;
        await deferral.queue.shift()!();
        expect(find).toHaveBeenCalledTimes(1);
        expect(issue).toHaveBeenCalledTimes(email === body.email ? 1 : 0);
      }
      expect(fakeEmailProvider.calls).toHaveLength(1);
      expect(fakeEmailProvider.calls[0]!.to).toBe(body.email);
    } finally {
      find.mockRestore();
      issue.mockRestore();
    }
  });

  it('several reset links may coexist; using one deletes ALL the others (a new request does not kill the old link)', async () => {
    const { body } = await signup();
    fakeEmailProvider.reset();
    await forgotCall(body.email);
    await forgotCall(body.email);
    const [first, second] = fakeEmailProvider.calls.map((m) => resetTokenIn(m.text));
    expect(first).not.toBe(second);
    const live = `SELECT 1 FROM "EmailToken" WHERE kind = 'RESET' AND "usedAt" IS NULL`;
    expect((await pg.query(live)).rowCount).toBe(2);
    expect((await resetCall(first!)).status).toBe(200);
    expect((await resetCall(second!)).status).toBe(410);
    expect((await pg.query(live)).rowCount).toBe(0);
  });

  it('keeps at most 5 live unused tokens per user and kind (the oldest go first)', async () => {
    const { body } = await signup();
    const user = (await pg.query('SELECT id FROM "User" WHERE email = $1', [body.email])).rows[0]
      .id as string;
    const expiresAt = new Date(Date.now() + 3_600_000);
    for (let i = 0; i < 7; i++)
      await emailTokenRepo.issue({ userId: user, kind: 'RESET', tokenHash: `cap-${i}`, expiresAt });
    const rows = (
      await pg.query(
        `SELECT "tokenHash" FROM "EmailToken" WHERE "userId" = $1 AND kind = 'RESET' ORDER BY "createdAt", "tokenHash"`,
        [user],
      )
    ).rows.map((r) => r.tokenHash as string);
    expect(rows).toEqual(['cap-2', 'cap-3', 'cap-4', 'cap-5', 'cap-6']);
    // The other kind is untouched.
    await emailTokenRepo.issue({ userId: user, kind: 'VERIFY', tokenHash: 'v-1', expiresAt });
    expect(
      (await pg.query(`SELECT 1 FROM "EmailToken" WHERE "userId" = $1 AND kind = 'RESET'`, [user]))
        .rowCount,
    ).toBe(5);
  });

  it('past 5 per hour per email the answer is the same 200: nothing issued or sent, no 429, known or unknown', async () => {
    const { body } = await signup();
    const unknownEmail = 'ghost@example.test';
    fakeEmailProvider.reset();
    for (const email of [body.email, unknownEmail])
      for (let i = 0; i < 5; i++) expect((await forgotCall(email)).status).toBe(200);
    expect(fakeEmailProvider.calls).toHaveLength(5);
    const tokens = `SELECT 1 FROM "EmailToken" WHERE kind = 'RESET'`;
    const before = (await pg.query(tokens)).rowCount;

    const knownOver = await forgotCall(body.email);
    const unknownOver = await forgotCall(unknownEmail);
    for (const r of [knownOver, unknownOver]) {
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true });
    }
    expect(fakeEmailProvider.calls).toHaveLength(5);
    expect((await pg.query(tokens)).rowCount).toBe(before);
    // Another address is unaffected.
    expect((await forgotCall('someone-else@example.test')).status).toBe(200);
    expect(fakeEmailProvider.calls).toHaveLength(5);
  });

  it('400 with fields on a bad email or an unknown field', async () => {
    const bad = await call(forgot, '/api/auth/forgot-password', { body: { email: 'nope' } });
    expect(bad.status).toBe(400);
    expect(bad.body!.error.fields).toHaveProperty('email');
    const extra = await call(forgot, '/api/auth/forgot-password', {
      body: { email: 'a@example.test', admin: true },
    });
    expect(extra.status).toBe(400);
    expect(extra.body!.error.fields).toHaveProperty('admin');
  });
});

describe('POST /api/auth/reset-password', () => {
  it('sets the new password once; the replay of the same token fails', async () => {
    const { body, token } = await requestReset();
    const ok = await resetCall(token);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true });

    expect((await loginCall(body.email, NEW_PASSWORD)).status).toBe(200);
    expect((await loginCall(body.email, PASSWORD)).status).toBe(401);
    const hash = (await pg.query('SELECT "passwordHash" FROM "User" WHERE email = $1', [body.email]))
      .rows[0].passwordHash as string;
    expect(hash).toMatch(/^\$argon2id\$/);

    const replay = await resetCall(token, 'yet-another-passphrase');
    expect(replay.status).toBe(410);
    expect(replay.body!.error.code).toBe('LINK_INVALID');
    expect((await loginCall(body.email, NEW_PASSWORD)).status).toBe(200);
  });

  it('two parallel resets with one token: exactly one wins', async () => {
    const { token } = await requestReset();
    const results = await Promise.all([resetCall(token), resetCall(token), resetCall(token)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 410, 410]);
  });

  it('an expired token fails and changes nothing', async () => {
    const { body, token } = await requestReset();
    await pg.query(`UPDATE "EmailToken" SET "expiresAt" = now() - interval '1 second'`);
    const res = await resetCall(token);
    expect(res.status).toBe(410);
    expect((await loginCall(body.email, PASSWORD)).status).toBe(200);
  });

  it('a forged token, a VERIFY token and an unknown shape all fail the same way', async () => {
    const { body, token } = await requestReset();
    const forged = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    await pg.query(
      `INSERT INTO "EmailToken" (id, "userId", kind, "tokenHash", "expiresAt")
       SELECT 'v1', id, 'VERIFY', $2, now() + interval '1 hour' FROM "User" WHERE email = $1`,
      [body.email, sha256Hex('verify-kind-token')],
    );
    for (const bad of [forged, 'x'.repeat(43), 'verify-kind-token', sha256Hex(token)]) {
      const res = await resetCall(bad);
      expect(res.status).toBe(410);
      expect(res.body!.error.code).toBe('LINK_INVALID');
    }
    expect((await loginCall(body.email, PASSWORD)).status).toBe(200);
  });

  it('a weak password is a 400 with fields and does not burn the token', async () => {
    const { token } = await requestReset();
    const weak = await resetCall(token, 'short');
    expect(weak.status).toBe(400);
    expect(weak.body!.error.code).toBe('VALIDATION_FAILED');
    expect(weak.body!.error.fields).toHaveProperty('newPassword');
    const tooLong = await resetCall(token, 'x'.repeat(129));
    expect(tooLong.status).toBe(400);
    expect((await resetCall(token)).status).toBe(200);
  });

  it('400 on an unknown field or a missing token', async () => {
    const extra = await call(resetPassword, '/api/auth/reset-password', {
      body: { token: 't', newPassword: NEW_PASSWORD, admin: true },
    });
    expect(extra.status).toBe(400);
    expect(extra.body!.error.fields).toHaveProperty('admin');
    const missing = await call(resetPassword, '/api/auth/reset-password', {
      body: { newPassword: NEW_PASSWORD },
    });
    expect(missing.status).toBe(400);
    expect(missing.body!.error.fields).toHaveProperty('token');
  });

  it('REVOKES ALL sessions of the user: an old cookie is dead', async () => {
    const { body, cookie, token } = await requestReset();
    const second = await loginCall(body.email, PASSWORD);
    expect(await meStatus(cookie)).toBe(200);
    expect(await meStatus(second.cookie!)).toBe(200);
    // A session in another business's context (user is a member of both) is revoked too.
    const other = await signup();
    await pg.query(
      `INSERT INTO "Membership" (id, "businessId", "userId", role)
       SELECT 'm-x', $1, id, 'STAFF' FROM "User" WHERE email = $2`,
      [other.info.business.id, body.email],
    );
    await pg.query(
      `INSERT INTO "Session" (id, "businessId", "userId", "tokenHash", "expiresAt")
       SELECT 's-other-biz', $1, id, 'other-biz-hash', now() + interval '1 day' FROM "User" WHERE email = $2`,
      [other.info.business.id, body.email],
    );

    expect((await resetCall(token)).status).toBe(200);

    expect(await meStatus(cookie)).toBe(401);
    expect(await meStatus(second.cookie!)).toBe(401);
    const left = await pg.query(
      `SELECT 1 FROM "Session" s JOIN "User" u ON u.id = s."userId" WHERE u.email = $1`,
      [body.email],
    );
    expect(left.rowCount).toBe(0);
    // Somebody else's sessions are untouched.
    expect(await meStatus(other.cookie)).toBe(200);
  });

  it('also marks the email verified (they proved control of the inbox)', async () => {
    const { body, token } = await requestReset({ verified: false });
    const before = await pg.query('SELECT "emailVerifiedAt" FROM "User" WHERE email = $1', [body.email]);
    expect(before.rows[0].emailVerifiedAt).toBeNull();
    expect((await resetCall(token)).status).toBe(200);
    const after = await pg.query('SELECT "emailVerifiedAt" FROM "User" WHERE email = $1', [body.email]);
    expect(after.rows[0].emailVerifiedAt).not.toBeNull();
    const login2 = await loginCall(body.email, NEW_PASSWORD);
    expect(login2.body!.user.emailVerified).toBe(true);
  });

  it('never writes the token or any password to the logs', async () => {
    const { token } = await requestReset();
    await resetCall(token);
    await resetCall(token);
    const logs = logLines.join('');
    expect(logs).toContain('password reset');
    expect(logs).not.toContain(token);
    expect(logs).not.toContain(sha256Hex(token));
    expect(logs).not.toContain(NEW_PASSWORD);
    expect(logs).not.toContain(PASSWORD);
    expect(logs).not.toMatch(/argon2id/);
  });
});

describe('POST /api/auth/change-password', () => {
  const change = (cookie: string | undefined, body: unknown) =>
    call(changePassword, '/api/auth/change-password', { body, cookie });

  it('needs a session', async () => {
    const res = await change(undefined, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
  });

  it('a wrong current password is a 400 on that field and changes nothing', async () => {
    const { cookie, body } = await signup();
    const res = await change(cookie, { currentPassword: 'not-my-password', newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body!.error.code).toBe('VALIDATION_FAILED');
    expect(res.body!.error.fields).toHaveProperty('currentPassword');
    expect((await loginCall(body.email, PASSWORD)).status).toBe(200);
    expect(await meStatus(cookie)).toBe(200);
  });

  it('succeeds: revokes the OTHER sessions, keeps the current one, and the new password works', async () => {
    const { cookie, body } = await signup();
    const other = await loginCall(body.email, PASSWORD);
    const third = await loginCall(body.email, PASSWORD);

    const res = await change(cookie, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(await meStatus(cookie)).toBe(200);
    expect(await meStatus(other.cookie!)).toBe(401);
    expect(await meStatus(third.cookie!)).toBe(401);
    expect((await loginCall(body.email, PASSWORD)).status).toBe(401);
    expect((await loginCall(body.email, NEW_PASSWORD)).status).toBe(200);
  });

  it('a weak new password is a 400 with fields; unknown fields are rejected', async () => {
    const { cookie } = await signup();
    const weak = await change(cookie, { currentPassword: PASSWORD, newPassword: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body!.error.fields).toHaveProperty('newPassword');
    const extra = await change(cookie, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      userId: 'someone-else',
    });
    expect(extra.status).toBe(400);
    expect(extra.body!.error.fields).toHaveProperty('userId');
  });

  it('is rate limited to 5 attempts per 15 minutes per user (429 RATE_LIMITED)', async () => {
    const { cookie, body } = await signup();
    const other = await signup();
    for (let i = 0; i < 5; i++)
      expect(
        (await change(cookie, { currentPassword: 'wrong-password-x', newPassword: NEW_PASSWORD })).status,
      ).toBe(400);
    const limited = await change(cookie, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(limited.status).toBe(429);
    expect(limited.body!.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    // The password was not changed by the limited request, and another user is unaffected.
    expect((await loginCall(body.email, PASSWORD)).status).toBe(200);
    const fine = await change(other.cookie, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(fine.status).toBe(200);
  });

  it('never writes either password to the logs', async () => {
    const { cookie } = await signup();
    await change(cookie, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    const logs = logLines.join('');
    expect(logs).toContain('password changed');
    expect(logs).not.toContain(NEW_PASSWORD);
    expect(logs).not.toContain(PASSWORD);
  });
});
