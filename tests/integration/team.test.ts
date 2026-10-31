/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are untyped JSON */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as signOutOthers } from '@/app/api/auth/sign-out-others/route';
import { POST as createInvite } from '@/app/api/invites/route';
import { POST as acceptInvite } from '@/app/api/invites/[token]/accept/route';
import { GET as previewInvite } from '@/app/api/invites/[token]/route';
import { GET as me } from '@/app/api/me/route';
import { GET as teamList } from '@/app/api/team/route';
import { DELETE as removeMember } from '@/app/api/team/members/[id]/route';
import { DELETE as revokeInvite } from '@/app/api/team/invites/[id]/route';
import { AppError } from '@/server/http/errors';
import { childLogger } from '@/server/http/logger';
import { fakeEmailProvider } from '@/server/providers/email';
import { teamService } from '@/server/services/team';
import { call, PASSWORD, signup } from './helpers/api';
import { newClient, setupSchema, truncateAll } from './helpers/db';

let pg: Client;
beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
});
afterAll(async () => {
  await pg.query('DROP TRIGGER IF EXISTS fail_membership_delete ON "Membership"').catch(() => {});
  await pg.end();
});
beforeEach(async () => {
  await pg.query('DROP TRIGGER IF EXISTS fail_membership_delete ON "Membership"');
  await truncateAll(pg);
  fakeEmailProvider.reset();
});

type Owner = Awaited<ReturnType<typeof signup>>;
const tokenOf = (acceptUrl: string) => acceptUrl.split('/invite/')[1]!;
const ownerId = (o: Owner) => o.info.user.id as string;

async function invite(cookie: string, email: string) {
  const res = await call(createInvite, '/api/invites', { body: { email, role: 'STAFF' }, cookie });
  expect(res.status).toBe(201);
  return { id: res.body!.id as string, token: tokenOf(res.body!.acceptUrl) };
}
const accept = (token: string, body: unknown) =>
  call(acceptInvite, `/api/invites/${token}/accept`, { body, params: { token } });

/** Invite + accept: a signed-in STAFF member. */
async function addStaff(owner: Owner, email: string, name = 'Karim') {
  const { token } = await invite(owner.cookie, email);
  const res = await accept(token, { name, password: PASSWORD });
  expect(res.status).toBe(200);
  return { cookie: res.cookie as string, userId: res.body!.user.id as string, email };
}

const list = (cookie?: string) => call(teamList, '/api/team', { cookie });
const remove = (cookie: string | undefined, id: string) =>
  call(removeMember, `/api/team/members/${id}`, { method: 'DELETE', cookie, params: { id } });
const revoke = (cookie: string | undefined, id: string) =>
  call(revokeInvite, `/api/team/invites/${id}`, { method: 'DELETE', cookie, params: { id } });
const meWith = (cookie: string) => call(me, '/api/me', { cookie });
const count = async (sql: string, args: unknown[] = []) =>
  (await pg.query(sql, args)).rows[0].n as number;

describe('GET /api/team', () => {
  it('lists members and pending invites, newest invite first, and nothing secret', async () => {
    const owner = await signup();
    const staff = await addStaff(owner, 'karim@example.test');
    const first = await invite(owner.cookie, 'a-first@example.test');
    await new Promise((r) => setTimeout(r, 15));
    const second = await invite(owner.cookie, 'b-second@example.test');

    const res = await list(owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body!.members).toHaveLength(2);
    const [mine, other] = res.body!.members;
    expect(mine).toEqual({
      userId: ownerId(owner),
      name: 'Owner',
      email: owner.body.email,
      role: 'OWNER',
      emailVerified: true,
      isYou: true,
    });
    expect(other).toEqual({
      userId: staff.userId,
      name: 'Karim',
      email: 'karim@example.test',
      role: 'STAFF',
      emailVerified: true,
      isYou: false,
    });
    expect(res.body!.invites.map((i: any) => i.id)).toEqual([second.id, first.id]);
    expect(Object.keys(res.body!.invites[0]).sort()).toEqual([
      'createdAt',
      'email',
      'expiresAt',
      'id',
      'role',
    ]);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/passwordHash|tokenHash|argon|session|token/i);
    expect(text).not.toContain(first.token);
    expect(text).not.toContain(second.token);
  });

  it('shows an unverified member as emailVerified false and hides expired or accepted invites', async () => {
    const owner = await signup();
    const staff = await addStaff(owner, 'karim@example.test');
    await pg.query(`UPDATE "User" SET "emailVerifiedAt" = NULL WHERE id = $1`, [staff.userId]);
    await invite(owner.cookie, 'expired@example.test');
    await pg.query(`UPDATE "Invite" SET "expiresAt" = now() - interval '1 minute'`);
    const res = await list(owner.cookie);
    expect(res.body!.members.find((m: any) => m.userId === staff.userId).emailVerified).toBe(false);
    expect(res.body!.invites).toEqual([]);
  });

  it('is tenant scoped', async () => {
    const a = await signup({ businessName: 'A', slug: 'team-a' });
    const b = await signup({ businessName: 'B', slug: 'team-b' });
    await addStaff(b, 'b-staff@example.test', 'Bee');
    await invite(b.cookie, 'b-pending@example.test');
    const res = await list(a.cookie);
    expect(res.body!.members).toHaveLength(1);
    expect(res.body!.invites).toEqual([]);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('b-staff@example.test');
    expect(text).not.toContain('b-pending@example.test');
    expect(text).not.toContain(b.info.business.id);
  });

  it('401 without a session, 403 for STAFF', async () => {
    const owner = await signup();
    const staff = await addStaff(owner, 'karim@example.test');
    expect((await list(undefined)).status).toBe(401);
    expect((await list(staff.cookie)).status).toBe(403);
  });
});

describe('DELETE /api/team/members/{id}', () => {
  it('removes the membership and that user sessions for this business in one go; the old cookie is 401', async () => {
    const owner = await signup();
    const staff = await addStaff(owner, 'karim@example.test');
    // A second session of the same user in the same business.
    const again = await call(login, '/api/auth/login', {
      body: { email: staff.email, password: PASSWORD },
    });
    expect(again.status).toBe(200);
    expect(await count(`SELECT count(*)::int n FROM "Session" WHERE "userId" = $1`, [staff.userId])).toBe(2);
    expect((await meWith(staff.cookie)).status).toBe(200);

    const res = await remove(owner.cookie, staff.userId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(await count(`SELECT count(*)::int n FROM "Membership" WHERE "userId" = $1`, [staff.userId])).toBe(0);
    expect(await count(`SELECT count(*)::int n FROM "Session" WHERE "userId" = $1`, [staff.userId])).toBe(0);
    expect((await meWith(staff.cookie)).status).toBe(401);
    expect((await meWith(again.cookie as string)).status).toBe(401);
    expect((await list(staff.cookie)).status).toBe(401);
    // The user row stays; the owner is untouched.
    expect(await count(`SELECT count(*)::int n FROM "User" WHERE id = $1`, [staff.userId])).toBe(1);
    expect((await meWith(owner.cookie)).status).toBe(200);
    expect((await list(owner.cookie)).body!.members).toHaveLength(1);
  });

  it('keeps the calendar person and appointments: the StaffMember is unlinked, not deleted', async () => {
    const owner = await signup();
    const staff = await addStaff(owner, 'karim@example.test');
    const before = (
      await pg.query(`SELECT id, "displayName", bookable, active FROM "StaffMember" WHERE "userId" = $1`, [
        staff.userId,
      ])
    ).rows;
    expect(before).toHaveLength(1);
    expect((await remove(owner.cookie, staff.userId)).status).toBe(200);
    const after = (
      await pg.query(`SELECT id, "displayName", bookable, active, "userId" FROM "StaffMember" WHERE id = $1`, [
        before[0].id,
      ])
    ).rows;
    expect(after).toEqual([{ ...before[0], userId: null }]);
  });

  it('also deletes pending invites for that email in this business only', async () => {
    const a = await signup({ businessName: 'A', slug: 'rm-a' });
    const b = await signup({ businessName: 'B', slug: 'rm-b' });
    const staff = await addStaff(a, 'karim@example.test');
    await invite(b.cookie, 'karim@example.test'); // other business: must survive
    await pg.query(
      `INSERT INTO "Invite" (id, "businessId", email, role, "tokenHash", "expiresAt")
       VALUES ('stale-invite-1', $1, 'karim@example.test', 'STAFF', 'hash-stale-1', now() + interval '1 day')`,
      [a.info.business.id],
    );
    expect((await remove(a.cookie, staff.userId)).status).toBe(200);
    expect(
      await count(`SELECT count(*)::int n FROM "Invite" WHERE "businessId" = $1 AND "acceptedAt" IS NULL`, [a.info.business.id]),
    ).toBe(0);
    expect(
      await count(`SELECT count(*)::int n FROM "Invite" WHERE "businessId" = $1`, [b.info.business.id]),
    ).toBe(1);
  });

  it('leaves the same user memberships and sessions in OTHER businesses untouched', async () => {
    const a = await signup({ businessName: 'A', slug: 'multi-a' });
    const b = await signup({ businessName: 'B', slug: 'multi-b' });
    const inA = await addStaff(a, 'karim@example.test');
    // The same account is invited into B (existing user: proves the password).
    const { token } = await invite(b.cookie, 'karim@example.test');
    const joinB = await accept(token, { name: 'Karim', password: PASSWORD });
    expect(joinB.status).toBe(200);
    expect(joinB.body!.business.id).toBe(b.info.business.id);

    expect((await remove(a.cookie, inA.userId)).status).toBe(200);
    expect((await meWith(inA.cookie)).status).toBe(401);
    const stillB = await meWith(joinB.cookie as string);
    expect(stillB.status).toBe(200);
    expect(stillB.body!.business.id).toBe(b.info.business.id);
    expect(
      await count(`SELECT count(*)::int n FROM "Membership" WHERE "userId" = $1 AND "businessId" = $2`, [
        inA.userId,
        b.info.business.id,
      ]),
    ).toBe(1);
    expect(
      await count(`SELECT count(*)::int n FROM "Session" WHERE "userId" = $1 AND "businessId" = $2`, [
        inA.userId,
        b.info.business.id,
      ]),
    ).toBe(1);
  });

  it('is atomic: if the membership delete fails nothing is committed (sessions stay)', async () => {
    const owner = await signup();
    const staff = await addStaff(owner, 'karim@example.test');
    await pg.query(`
      CREATE OR REPLACE FUNCTION fail_membership_delete() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'injected failure'; END; $$ LANGUAGE plpgsql`);
    await pg.query(`
      CREATE TRIGGER fail_membership_delete BEFORE DELETE ON "Membership"
      FOR EACH ROW EXECUTE FUNCTION fail_membership_delete()`);
    const res = await remove(owner.cookie, staff.userId);
    expect(res.status).toBe(500);
    await pg.query('DROP TRIGGER fail_membership_delete ON "Membership"');
    expect(await count(`SELECT count(*)::int n FROM "Membership" WHERE "userId" = $1`, [staff.userId])).toBe(1);
    expect(await count(`SELECT count(*)::int n FROM "Session" WHERE "userId" = $1`, [staff.userId])).toBe(1);
    expect(
      await count(`SELECT count(*)::int n FROM "StaffMember" WHERE "userId" = $1`, [staff.userId]),
    ).toBe(1);
    expect((await meWith(staff.cookie)).status).toBe(200);
  });

  it('a removed user can be invited again and accept with the existing account', async () => {
    const owner = await signup();
    const staff = await addStaff(owner, 'karim@example.test');
    expect((await remove(owner.cookie, staff.userId)).status).toBe(200);
    const { token } = await invite(owner.cookie, 'karim@example.test');
    const back = await accept(token, { name: 'Karim', password: PASSWORD });
    expect(back.status).toBe(200);
    expect(back.body!.user.id).toBe(staff.userId);
    expect(back.body!.role).toBe('STAFF');
    expect((await meWith(back.cookie as string)).status).toBe(200);
    // The pre-removal cookie stays dead: removal deleted that session row.
    expect((await meWith(staff.cookie)).status).toBe(401);
  });

  it('403 for STAFF, 401 without a session', async () => {
    const owner = await signup();
    const staff = await addStaff(owner, 'karim@example.test');
    const second = await addStaff(owner, 'rana@example.test', 'Rana');
    expect((await remove(staff.cookie, second.userId)).status).toBe(403);
    expect((await remove(undefined, second.userId)).status).toBe(401);
    expect(await count(`SELECT count(*)::int n FROM "Membership"`)).toBe(3);
  });

  it('an owner cannot remove themselves (409 CANNOT_REMOVE_SELF)', async () => {
    const owner = await signup();
    const res = await remove(owner.cookie, ownerId(owner));
    expect(res.status).toBe(409);
    expect(res.body!.error.code).toBe('CANNOT_REMOVE_SELF');
    expect((await meWith(owner.cookie)).status).toBe(200);
  });

  it('the last owner can never be removed (409 LAST_OWNER), even by a stale owner context', async () => {
    const owner = await signup();
    const ctx = {
      requestId: 'req-last-owner',
      logger: childLogger({ requestId: 'req-last-owner' }),
      businessId: owner.info.business.id as string,
      userId: 'someone-who-is-no-longer-an-owner',
      role: 'OWNER' as const,
      sessionId: 'stale',
    };
    const error = await teamService.removeMember(ctx, ownerId(owner)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ status: 409, code: 'LAST_OWNER' });
    expect(await count(`SELECT count(*)::int n FROM "Membership"`)).toBe(1);
    expect((await meWith(owner.cookie)).status).toBe(200);
  });

  it('two owners removing each other at the same moment never leave the business without an owner', async () => {
    const a = await signup();
    const staff = await addStaff(a, 'second@example.test', 'Second');
    await pg.query(`UPDATE "Membership" SET role = 'OWNER' WHERE "userId" = $1`, [staff.userId]);
    const results = await Promise.all([
      remove(a.cookie, staff.userId),
      remove(staff.cookie, ownerId(a)),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(
      await count(`SELECT count(*)::int n FROM "Membership" WHERE "businessId" = $1 AND role = 'OWNER'`, [
        a.info.business.id,
      ]),
    ).toBe(1);
  });

  it('an owner can remove another owner when one remains', async () => {
    const a = await signup();
    const staff = await addStaff(a, 'second@example.test', 'Second');
    await pg.query(`UPDATE "Membership" SET role = 'OWNER' WHERE "userId" = $1`, [staff.userId]);
    expect((await remove(a.cookie, staff.userId)).status).toBe(200);
    expect((await meWith(staff.cookie)).status).toBe(401);
  });

  it('404 across tenants (nothing changes), 404 for unknown ids, 404 for a second removal', async () => {
    const a = await signup({ businessName: 'A', slug: 'x-a' });
    const b = await signup({ businessName: 'B', slug: 'x-b' });
    const bStaff = await addStaff(b, 'karim@example.test');
    const cross = await remove(a.cookie, bStaff.userId);
    expect(cross.status).toBe(404);
    const crossOwner = await remove(a.cookie, ownerId(b));
    expect(crossOwner.status).toBe(404);
    expect(crossOwner.body).toEqual(cross.body);
    expect((await meWith(bStaff.cookie)).status).toBe(200);
    expect((await remove(a.cookie, 'c0123456789abcdefghijklmn')).status).toBe(404);

    const aStaff = await addStaff(a, 'rana@example.test', 'Rana');
    expect((await remove(a.cookie, aStaff.userId)).status).toBe(200);
    const again = await remove(a.cookie, aStaff.userId);
    expect(again.status).toBe(404);
    expect(again.body!.error.code).toBe('NOT_FOUND');
  });

  it('400 for a malformed id', async () => {
    const owner = await signup();
    const res = await remove(owner.cookie, 'not an id!');
    expect(res.status).toBe(400);
    expect(res.body!.error.code).toBe('VALIDATION_FAILED');
    expect(res.body!.error.fields.id).toBeTruthy();
  });

  it('defense in depth: with ONLY the Membership row deleted, the surviving session row is rejected', async () => {
    const owner = await signup();
    const staff = await addStaff(owner, 'karim@example.test');
    expect((await meWith(staff.cookie)).status).toBe(200);
    await pg.query(`DELETE FROM "Membership" WHERE "userId" = $1`, [staff.userId]);
    expect(await count(`SELECT count(*)::int n FROM "Session" WHERE "userId" = $1`, [staff.userId])).toBe(1);
    expect((await meWith(staff.cookie)).status).toBe(401);
    expect((await list(staff.cookie)).status).toBe(401);
    const apiCall = await call(createInvite, '/api/invites', {
      body: { email: 'x@example.test', role: 'STAFF' },
      cookie: staff.cookie,
    });
    expect(apiCall.status).toBe(401);
  });
});

describe('DELETE /api/team/invites/{id}', () => {
  it('revokes a pending invite: the accept link stops working at once and the list is updated', async () => {
    const owner = await signup();
    const { id, token } = await invite(owner.cookie, 'karim@example.test');
    const unknownPreview = await call(previewInvite, '/api/invites/nope', { params: { token: 'nope' } });
    const res = await revoke(owner.cookie, id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(await count(`SELECT count(*)::int n FROM "Invite"`)).toBe(0);
    const preview = await call(previewInvite, `/api/invites/${token}`, { params: { token } });
    expect(preview.status).toBe(404);
    expect(preview.body).toEqual(unknownPreview.body);
    const accepted = await accept(token, { name: 'Karim', password: PASSWORD });
    expect(accepted.status).toBe(404);
    expect(accepted.body!.error.message).toBe('This invitation is not valid.');
    expect((await list(owner.cookie)).body!.invites).toEqual([]);
    expect(await count(`SELECT count(*)::int n FROM "User" WHERE email = 'karim@example.test'`)).toBe(0);
  });

  it('404 for an unknown id, a second revoke, an accepted invite and another business invite', async () => {
    const a = await signup({ businessName: 'A', slug: 'iv-a' });
    const b = await signup({ businessName: 'B', slug: 'iv-b' });
    const bInvite = await invite(b.cookie, 'b-pending@example.test');
    const cross = await revoke(a.cookie, bInvite.id);
    expect(cross.status).toBe(404);
    // The other business invite still works.
    const preview = await call(previewInvite, `/api/invites/${bInvite.token}`, {
      params: { token: bInvite.token },
    });
    expect(preview.status).toBe(200);
    expect((await revoke(a.cookie, 'c0123456789abcdefghijklmn')).status).toBe(404);

    const mine = await invite(a.cookie, 'karim@example.test');
    expect((await accept(mine.token, { name: 'Karim', password: PASSWORD })).status).toBe(200);
    expect((await revoke(a.cookie, mine.id)).status).toBe(404); // accepted

    const other = await invite(a.cookie, 'rana@example.test');
    expect((await revoke(a.cookie, other.id)).status).toBe(200);
    expect((await revoke(a.cookie, other.id)).status).toBe(404);
  });

  it('403 for STAFF, 401 without a session, 400 for a malformed id', async () => {
    const owner = await signup();
    const staff = await addStaff(owner, 'karim@example.test');
    const { id } = await invite(owner.cookie, 'rana@example.test');
    expect((await revoke(staff.cookie, id)).status).toBe(403);
    expect((await revoke(undefined, id)).status).toBe(401);
    const bad = await revoke(owner.cookie, 'not an id!');
    expect(bad.status).toBe(400);
    expect(bad.body!.error.code).toBe('VALIDATION_FAILED');
    expect(await count(`SELECT count(*)::int n FROM "Invite" WHERE id = $1`, [id])).toBe(1);
  });
});

describe('POST /api/auth/sign-out-others', () => {
  it('keeps the current session and deletes the user other sessions in every business', async () => {
    const a = await signup({ businessName: 'A', slug: 'so-a' });
    const b = await signup({ businessName: 'B', slug: 'so-b' });
    const staff = await addStaff(a, 'karim@example.test');
    const second = await call(login, '/api/auth/login', {
      body: { email: staff.email, password: PASSWORD },
    });
    // The same account in business B (a session whose businessId differs).
    const { token } = await invite(b.cookie, staff.email);
    const inB = await accept(token, { name: 'Karim', password: PASSWORD });
    expect(inB.status).toBe(200);
    expect(await count(`SELECT count(*)::int n FROM "Session" WHERE "userId" = $1`, [staff.userId])).toBe(3);

    const res = await call(signOutOthers, '/api/auth/sign-out-others', {
      method: 'POST',
      cookie: staff.cookie,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ removed: 2 });
    expect((await meWith(staff.cookie)).status).toBe(200);
    expect((await meWith(second.cookie as string)).status).toBe(401);
    expect((await meWith(inB.cookie as string)).status).toBe(401);
    // Other people are not affected.
    expect((await meWith(a.cookie)).status).toBe(200);
    expect((await meWith(b.cookie)).status).toBe(200);
    expect(await count(`SELECT count(*)::int n FROM "Session" WHERE "userId" = $1`, [staff.userId])).toBe(1);
    // Memberships are untouched.
    expect(await count(`SELECT count(*)::int n FROM "Membership" WHERE "userId" = $1`, [staff.userId])).toBe(2);
  });

  it('answers removed 0 when there is nothing else, and 401 without a session', async () => {
    const owner = await signup();
    const res = await call(signOutOthers, '/api/auth/sign-out-others', {
      method: 'POST',
      cookie: owner.cookie,
    });
    expect(res.body).toEqual({ removed: 0 });
    expect(
      (await call(signOutOthers, '/api/auth/sign-out-others', { method: 'POST' })).status,
    ).toBe(401);
  });

  it('rejects a cross-origin request', async () => {
    const owner = await signup();
    const res = await call(signOutOthers, '/api/auth/sign-out-others', {
      method: 'POST',
      cookie: owner.cookie,
      headers: { origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });
});
