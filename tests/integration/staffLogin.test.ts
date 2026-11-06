/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are untyped JSON */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { GET as previewActivation, POST as activate } from '@/app/api/activation/[token]/route';
import { POST as changePassword } from '@/app/api/auth/change-password/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as resendVerification } from '@/app/api/auth/resend-verification/route';
import { POST as createInvite } from '@/app/api/invites/route';
import { POST as acceptInvite } from '@/app/api/invites/[token]/accept/route';
import { GET as me } from '@/app/api/me/route';
import { PATCH as patchStaff } from '@/app/api/staff/[id]/route';
import { DELETE as turnOff, POST as giveLogin } from '@/app/api/staff/[id]/login/route';
import { GET as listStaff, POST as createStaff } from '@/app/api/staff/route';
import { GET as teamList } from '@/app/api/team/route';
import { GET as dashboardToday } from '@/app/api/dashboard/today/route';
import { fakeEmailProvider } from '@/server/providers/email';
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

type Owner = Awaited<ReturnType<typeof signup>>;
const PHONE = '+96170000001';
const PHONE2 = '+96170000002';
const tokenOf = (url: string) => url.split('/activate/')[1]!;
const n = async (sql: string, args: unknown[] = []) =>
  Number((await pg.query(sql, args)).rows[0].n);

async function newStaff(owner: Owner, displayName = 'Barber One') {
  const res = await call(createStaff, '/api/staff', {
    body: { displayName, bookable: false, serviceIds: [] },
    cookie: owner.cookie,
  });
  expect(res.status).toBe(201);
  return res.body!.id as string;
}
const link = (cookie: string | undefined, id: string, body: unknown = { phone: PHONE }) =>
  call(giveLogin, `/api/staff/${id}/login`, { body, cookie, params: { id } });
const off = (cookie: string | undefined, id: string) =>
  call(turnOff, `/api/staff/${id}/login`, { method: 'DELETE', cookie, params: { id } });
const activateWith = (token: string, password = PASSWORD) =>
  call(activate, `/api/activation/${token}`, { body: { password }, params: { token } });
const previewOf = (token: string) =>
  call(previewActivation, `/api/activation/${token}`, { params: { token } });
const loginAs = (identifier: string, password = PASSWORD) =>
  call(login, '/api/auth/login', { body: { identifier, password } });

/** Owner gives a login and the barber activates it. */
async function activated(owner: Owner, phone = PHONE, name = 'Barber One') {
  const staffId = await newStaff(owner, name);
  const l = await link(owner.cookie, staffId, { phone });
  expect(l.status).toBe(200);
  const act = await activateWith(tokenOf(l.body!.url));
  expect(act.status).toBe(200);
  return {
    staffId,
    cookie: act.cookie as string,
    userId: act.body!.user.id as string,
    token: tokenOf(l.body!.url),
  };
}

async function addReceptionist(owner: Owner, email: string) {
  const inv = await call(createInvite, '/api/invites', {
    body: { email, role: 'STAFF' },
    cookie: owner.cookie,
  });
  expect(inv.status).toBe(201);
  const token = (inv.body!.acceptUrl as string).split('/invite/')[1]!;
  const res = await call(acceptInvite, `/api/invites/${token}/accept`, {
    body: { name: 'Reception', password: PASSWORD },
    params: { token },
  });
  expect(res.status).toBe(200);
  return res.cookie as string;
}

describe('owner creates a link', () => {
  it('stores only the hash, returns a wa.me url with the link and the phone, and no password', async () => {
    const owner = await signup();
    const staffId = await newStaff(owner);
    const res = await link(owner.cookie, staffId, { phone: '70 000 001' });
    expect(res.status).toBe(200);
    const token = tokenOf(res.body!.url);
    expect(res.body!.phone).toBe(PHONE);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const wa = new URL(res.body!.whatsappUrl);
    expect(wa.hostname).toBe('wa.me');
    expect(wa.pathname).toBe('/96170000001');
    const text = wa.searchParams.get('text')!;
    expect(text).toContain(res.body!.url);
    expect(text).toContain(PHONE);
    expect(text.toLowerCase()).not.toContain('password:');
    const row = (await pg.query(`SELECT "tokenHash", "expiresAt", "usedAt" FROM "ActivationToken"`))
      .rows;
    expect(row).toHaveLength(1);
    expect(row[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row[0].tokenHash).not.toContain(token);
    const hours = (row[0].expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(71.9);
    expect(hours).toBeLessThan(72.1);
  });

  it('shows NOT_ACTIVATED with the phone to the owner but not to a receptionist', async () => {
    const owner = await signup();
    const reception = await addReceptionist(owner, 'rec@example.test');
    const staffId = await newStaff(owner);
    await link(owner.cookie, staffId);
    const asOwner = (
      await call(listStaff, '/api/staff', { cookie: owner.cookie })
    ).body!.staff.find((s: any) => s.id === staffId);
    expect(asOwner).toMatchObject({ loginStatus: 'NOT_ACTIVATED', loginPhone: PHONE });
    const asRec = (await call(listStaff, '/api/staff', { cookie: reception })).body!.staff.find(
      (s: any) => s.id === staffId,
    );
    expect(asRec).toMatchObject({ loginStatus: 'NOT_ACTIVATED', loginPhone: null });
  });

  it('400 on a bad phone, a missing phone and unknown fields', async () => {
    const owner = await signup();
    const staffId = await newStaff(owner);
    const bad = await link(owner.cookie, staffId, { phone: 'not a number' });
    expect(bad.status).toBe(400);
    expect(bad.body!.error.fields.phone).toBeTruthy();
    expect((await link(owner.cookie, staffId, {})).status).toBe(400);
    expect((await link(owner.cookie, staffId, { phone: PHONE, extra: 1 })).status).toBe(400);
  });

  it('is OWNER only (receptionist 403, no session 401) and 404 across businesses', async () => {
    const owner = await signup();
    const other = await signup();
    const reception = await addReceptionist(owner, 'rec2@example.test');
    const staffId = await newStaff(owner);
    expect((await link(reception, staffId)).status).toBe(403);
    expect((await link(undefined, staffId)).status).toBe(401);
    expect((await link(other.cookie, staffId)).status).toBe(404);
    expect((await off(other.cookie, staffId)).status).toBe(404);
    expect(await n(`SELECT count(*) AS n FROM "ActivationToken"`)).toBe(0);
  });

  it('refuses the owner and receptionists (they keep their own login)', async () => {
    const owner = await signup();
    await addReceptionist(owner, 'rec3@example.test');
    const people = (await call(listStaff, '/api/staff', { cookie: owner.cookie })).body!
      .staff as any[];
    expect(people.length).toBeGreaterThanOrEqual(2);
    for (const p of people) {
      expect(p.loginStatus).toBeNull();
      const res = await link(owner.cookie, p.id);
      expect(res.status).toBe(409);
      expect(res.body!.error.code).toBe('LOGIN_NOT_ALLOWED');
    }
  });

  it('PHONE_IN_USE when the number belongs to a practitioner of another business or to an e-mail account', async () => {
    const a = await signup();
    const b = await signup();
    await activated(a, PHONE);
    const bStaff = await newStaff(b);
    const res = await link(b.cookie, bStaff, { phone: PHONE });
    expect(res.status).toBe(409);
    expect(res.body!.error.code).toBe('PHONE_IN_USE');
    await pg.query(`UPDATE "User" SET phone = $1 WHERE email = $2`, [PHONE2, a.body.email]);
    const res2 = await link(b.cookie, bStaff, { phone: PHONE2 });
    expect(res2.body!.error.code).toBe('PHONE_IN_USE');
  });

  it('PHONE_IN_USE when another staff member of the same business already has that number', async () => {
    const owner = await signup();
    await activated(owner, PHONE);
    const second = await newStaff(owner, 'Barber Two');
    const res = await link(owner.cookie, second, { phone: PHONE });
    expect(res.body!.error.code).toBe('PHONE_IN_USE');
  });
});

describe('activation page API', () => {
  it('activates once: password chosen, PRACTITIONER session, no email, staff linked', async () => {
    const owner = await signup();
    const staffId = await newStaff(owner);
    const l = await link(owner.cookie, staffId);
    const token = tokenOf(l.body!.url);
    expect((await previewOf(token)).status).toBe(200);
    expect((await activateWith(token, 'short')).status).toBe(400);
    expect((await previewOf(token)).status).toBe(200); // a weak password does not use the link up
    const res = await activateWith(token, 'a brand new password');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      role: 'PRACTITIONER',
      user: { email: null, phone: PHONE, emailVerified: false },
    });
    expect(res.headers.get('cache-control')).toBe('no-store');
    const who = await call(me, '/api/me', { cookie: res.cookie });
    expect(who.status).toBe(200);
    expect(who.body!.role).toBe('PRACTITIONER');
    const staff = (
      await pg.query(`SELECT "userId", "loginOffAt" FROM "StaffMember" WHERE id = $1`, [staffId])
    ).rows[0];
    expect(staff.userId).toBe(res.body!.user.id);
    expect(staff.loginOffAt).toBeNull();
    expect(await n(`SELECT count(*) AS n FROM "Membership" WHERE role = 'PRACTITIONER'`)).toBe(1);
    const list = (await call(listStaff, '/api/staff', { cookie: owner.cookie })).body!.staff.find(
      (s: any) => s.id === staffId,
    );
    expect(list).toMatchObject({ loginStatus: 'ACTIVE', loginPhone: PHONE, role: 'PRACTITIONER' });
  });

  it('replay, parallel use and garbage all answer the same 404', async () => {
    const owner = await signup();
    const staffId = await newStaff(owner);
    const token = tokenOf((await link(owner.cookie, staffId)).body!.url);
    const [x, y] = await Promise.all([
      activateWith(token),
      activateWith(token, 'another good password'),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 404]);
    const replay = await activateWith(token);
    const garbage = await activateWith('x'.repeat(43));
    const preview = await previewOf(token);
    for (const r of [replay, garbage, preview]) {
      expect(r.status).toBe(404);
      expect(r.body!.error.code).toBe('NOT_FOUND');
    }
    expect(replay.body).toEqual(garbage.body);
    expect(await n(`SELECT count(*) AS n FROM "User" WHERE phone = $1`, [PHONE])).toBe(1);
  });

  it('an expired link is the same 404 and creates nothing', async () => {
    const owner = await signup();
    const staffId = await newStaff(owner);
    const token = tokenOf((await link(owner.cookie, staffId)).body!.url);
    await pg.query(`UPDATE "ActivationToken" SET "expiresAt" = now() - interval '1 minute'`);
    expect((await activateWith(token)).status).toBe(404);
    expect((await previewOf(token)).status).toBe(404);
    expect(await n(`SELECT count(*) AS n FROM "User" WHERE phone IS NOT NULL`)).toBe(0);
  });

  it('a new link invalidates the old one', async () => {
    const owner = await signup();
    const staffId = await newStaff(owner);
    const first = tokenOf((await link(owner.cookie, staffId)).body!.url);
    const second = tokenOf((await link(owner.cookie, staffId)).body!.url);
    expect(await n(`SELECT count(*) AS n FROM "ActivationToken" WHERE "usedAt" IS NULL`)).toBe(1);
    expect((await activateWith(first)).status).toBe(404);
    expect((await activateWith(second)).status).toBe(200);
  });

  it('validation: unknown fields are rejected', async () => {
    const res = await call(activate, '/api/activation/abc', {
      body: { password: PASSWORD, extra: 1 },
      params: { token: 'abc' },
    });
    expect(res.status).toBe(400);
  });
});

describe('signing in as a barber', () => {
  it('works with the phone in any spelling, and with the e-mail path unchanged', async () => {
    const owner = await signup();
    await activated(owner);
    for (const spelling of ['70 000 001', '+961 70 000 001', '0096170000001', PHONE]) {
      const res = await loginAs(spelling);
      expect(res.status).toBe(200);
      expect(res.body!.role).toBe('PRACTITIONER');
    }
    expect((await loginAs(owner.body.email)).body!.role).toBe('OWNER');
    const legacy = await call(login, '/api/auth/login', {
      body: { email: owner.body.email, password: PASSWORD },
    });
    expect(legacy.status).toBe(200);
  });

  it('unknown phone, wrong password and garbage give the same 401 body', async () => {
    const owner = await signup();
    await activated(owner);
    const wrong = await loginAs(PHONE, 'wrong password!!');
    const unknown = await loginAs('+96170000099');
    const garbage = await loginAs('hello');
    for (const r of [wrong, unknown, garbage]) expect(r.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(garbage.body).toEqual(wrong.body);
  });

  it('locks a phone after 5 attempts whatever the spelling', async () => {
    const owner = await signup();
    await activated(owner);
    const spellings = [
      '70 000 001',
      '+96170000001',
      '0096170000001',
      '70000001',
      '+961 70 000 001',
    ];
    for (const s of spellings) expect((await loginAs(s, 'nope nope nope')).status).toBe(401);
    expect((await loginAs(PHONE)).status).toBe(429);
  });

  it('can change the password and sign out others, and sees nothing of the business', async () => {
    const owner = await signup();
    const b = await activated(owner);
    const change = await call(changePassword, '/api/auth/change-password', {
      body: { currentPassword: PASSWORD, newPassword: 'a different password' },
      cookie: b.cookie,
    });
    expect(change.status).toBe(200);
    expect((await loginAs(PHONE, 'a different password')).status).toBe(200);
    // PR-5: the barber's own (empty) day is allowed; the owner-only routes stay refused.
    const day = await call(dashboardToday, '/api/dashboard/today', { cookie: b.cookie });
    expect(day.status).toBe(200);
    expect(day.body!.appointments).toEqual([]);
    expect((await call(listStaff, '/api/staff', { cookie: b.cookie })).status).toBe(403);
    expect((await call(teamList, '/api/team', { cookie: b.cookie })).status).toBe(403);
  });

  it('has no email: resend-verification is a clean 409 and nothing is sent', async () => {
    const owner = await signup();
    const b = await activated(owner);
    fakeEmailProvider.reset();
    const res = await call(resendVerification, '/api/auth/resend-verification', {
      method: 'POST',
      body: {},
      cookie: b.cookie,
    });
    expect(res.status).toBe(409);
    expect(res.body!.error.code).toBe('NO_EMAIL');
    expect(fakeEmailProvider.calls).toHaveLength(0);
  });

  it('is not listed in Team access', async () => {
    const owner = await signup();
    await activated(owner);
    const res = await call(teamList, '/api/team', { cookie: owner.cookie });
    expect(res.body!.members.every((m: any) => m.role !== 'PRACTITIONER')).toBe(true);
  });
});

describe('reset access and turn off', () => {
  it('reset revokes the sessions at once and the new link sets a new password', async () => {
    const owner = await signup();
    const b = await activated(owner);
    const reset = await link(owner.cookie, b.staffId, {});
    expect(reset.status).toBe(200);
    expect(reset.body!.reset).toBe(true);
    expect(reset.body!.phone).toBe(PHONE);
    expect((await call(me, '/api/me', { cookie: b.cookie })).status).toBe(401);
    const act = await activateWith(tokenOf(reset.body!.url), 'my second password');
    expect(act.status).toBe(200);
    expect(act.body!.user.id).toBe(b.userId);
    expect((await loginAs(PHONE, PASSWORD)).status).toBe(401);
    expect((await loginAs(PHONE, 'my second password')).status).toBe(200);
    expect(await n(`SELECT count(*) AS n FROM "User" WHERE phone = $1`, [PHONE])).toBe(1);
  });

  it('turn off revokes sessions and the open link, keeps the StaffMember, and is idempotent', async () => {
    const owner = await signup();
    const b = await activated(owner);
    expect((await off(owner.cookie, b.staffId)).status).toBe(200);
    expect((await off(owner.cookie, b.staffId)).status).toBe(200);
    expect((await call(me, '/api/me', { cookie: b.cookie })).status).toBe(401);
    expect((await loginAs(PHONE)).status).toBe(401);
    const staff = (
      await pg.query(`SELECT "userId", "loginOffAt" FROM "StaffMember" WHERE id = $1`, [b.staffId])
    ).rows[0];
    expect(staff.userId).toBeNull();
    expect(staff.loginOffAt).not.toBeNull();
    expect(await n(`SELECT count(*) AS n FROM "Session" WHERE "userId" = $1`, [b.userId])).toBe(0);
    expect(await n(`SELECT count(*) AS n FROM "Membership" WHERE "userId" = $1`, [b.userId])).toBe(
      0,
    );
    const row = (await call(listStaff, '/api/staff', { cookie: owner.cookie })).body!.staff.find(
      (s: any) => s.id === b.staffId,
    );
    expect(row.loginStatus).toBe('OFF');
    // And it can be given again.
    const again = await link(owner.cookie, b.staffId, { phone: PHONE });
    expect((await activateWith(tokenOf(again.body!.url))).status).toBe(200);
  });

  it('turning off a person who only has a pending link kills the link', async () => {
    const owner = await signup();
    const staffId = await newStaff(owner);
    const token = tokenOf((await link(owner.cookie, staffId)).body!.url);
    await off(owner.cookie, staffId);
    expect((await activateWith(token)).status).toBe(404);
  });

  it('deactivating the staff member revokes the login too', async () => {
    const owner = await signup();
    const b = await activated(owner);
    const res = await call(patchStaff, `/api/staff/${b.staffId}`, {
      method: 'PATCH',
      body: { active: false },
      cookie: owner.cookie,
      params: { id: b.staffId },
    });
    expect(res.status).toBe(200);
    expect((await call(me, '/api/me', { cookie: b.cookie })).status).toBe(401);
    expect(res.body!.loginStatus).toBe('OFF');
  });
});
