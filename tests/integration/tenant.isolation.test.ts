import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { POST as createInvite } from '@/app/api/invites/route';
import { GET as previewInvite } from '@/app/api/invites/[token]/route';
import { GET as me } from '@/app/api/me/route';
import { PATCH as patchService } from '@/app/api/services/[id]/route';
import { GET as listServices, POST as postService } from '@/app/api/services/route';
import { PATCH as patchStaff } from '@/app/api/staff/[id]/route';
import { GET as getHours } from '@/app/api/staff/[id]/hours/route';
import { PUT as putStaffServices } from '@/app/api/staff/[id]/services/route';
import { GET as listTimeOff } from '@/app/api/staff/[id]/time-off/route';
import { GET as listStaff, POST as postStaff } from '@/app/api/staff/route';
import { fakeEmailProvider } from '@/server/providers/email';
import { loginThrottle } from '@/server/services/loginThrottle';
import { call, signup } from './helpers/api';
import { newClient, setupSchema, truncateAll } from './helpers/db';

/**
 * Tenant isolation scaffold. Two businesses; business A's session must never see or touch business B's
 * data on any route that exists. Entries for later routes are `it.todo` and are filled in as each
 * resource lands (P2).
 */
let pg: Client;
let a: Awaited<ReturnType<typeof signup>>;
let b: Awaited<ReturnType<typeof signup>>;

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
  loginThrottle.reset();
  fakeEmailProvider.reset();
  a = await signup({ businessName: 'Business A', slug: 'business-a' });
  b = await signup({ businessName: 'Business B', slug: 'business-b' });
});

describe('tenant isolation: routes that exist now', () => {
  it('/api/me only ever returns the session’s own user and business', async () => {
    const ra = await call(me, '/api/me', { cookie: a.cookie });
    const rb = await call(me, '/api/me', { cookie: b.cookie });
    expect(ra.body!.business.id).toBe(a.info.business.id);
    expect(rb.body!.business.id).toBe(b.info.business.id);
    expect(JSON.stringify(ra.body)).not.toContain(b.info.business.id);
    expect(JSON.stringify(ra.body)).not.toContain(b.info.user.id);
    expect(JSON.stringify(ra.body)).not.toContain(b.body.email);
  });

  it('/api/me ignores a businessId supplied by the client', async () => {
    const res = await call(me, '/api/me', {
      cookie: a.cookie,
      query: { businessId: b.info.business.id },
      headers: { 'x-business-id': b.info.business.id },
    });
    expect(res.status).toBe(200);
    expect(res.body!.business.id).toBe(a.info.business.id);
  });

  it('invites created by A belong to A and the body cannot name another business', async () => {
    const created = await call(createInvite, '/api/invites', {
      body: { email: 'x@example.test', role: 'STAFF' },
      cookie: a.cookie,
    });
    expect(created.status).toBe(201);
    const rows = (await pg.query('SELECT "businessId" FROM "Invite"')).rows;
    expect(rows).toEqual([{ businessId: a.info.business.id }]);

    const forged = await call(createInvite, '/api/invites', {
      body: { email: 'y@example.test', role: 'STAFF', businessId: b.info.business.id },
      cookie: a.cookie,
    });
    expect(forged.status).toBe(400);
    expect(
      (await pg.query('SELECT 1 FROM "Invite" WHERE "businessId" = $1', [b.info.business.id]))
        .rowCount,
    ).toBe(0);
  });

  it('A re-inviting an email never replaces or reveals B’s open invite for the same email', async () => {
    const forB = await call(createInvite, '/api/invites', {
      body: { email: 'shared@example.test', role: 'STAFF' },
      cookie: b.cookie,
    });
    const tokenB = forB.body!.acceptUrl.split('/invite/')[1];
    await call(createInvite, '/api/invites', {
      body: { email: 'shared@example.test', role: 'STAFF' },
      cookie: a.cookie,
    });
    const prev = await call(previewInvite, `/api/invites/${tokenB}`, { params: { token: tokenB } });
    expect(prev.status).toBe(200);
    expect(prev.body!.businessName).toBe('Business B');
    expect((await pg.query('SELECT 1 FROM "Invite"')).rowCount).toBe(2);
  });

  it('a session is bound to its business: A’s cookie cannot act as B even for the same user id', async () => {
    const sessions = (await pg.query('SELECT "businessId", "userId" FROM "Session"')).rows;
    expect(new Set(sessions.map((s) => s.businessId)).size).toBe(2);
    const res = await call(me, '/api/me', { cookie: a.cookie });
    expect(res.body!.role).toBe('OWNER');
    expect(res.body!.business.slug).toBe('business-a');
  });
});

describe('tenant isolation: arrives with later routes (P2)', () => {
  it.todo('GET /api/appointments/{id} with business B’s id and A’s session -> 404');
  it.todo('PATCH/DELETE /api/appointments/{id} cross-tenant -> 404 and B’s row unchanged');
  it.todo('GET /api/clients/{id} cross-tenant -> 404');
  it.todo('GET /api/clients list never includes business B’s clients');
  it('PATCH /api/services/{id} cross-tenant -> 404 and B’s row unchanged (no DELETE route exists)', async () => {
    const sb = await call(postService, '/api/services', {
      cookie: b.cookie,
      body: { name: 'B cut', durationMin: 30, price: 10 },
    });
    const res = await call(patchService, `/api/services/${sb.body!.id}`, {
      method: 'PATCH',
      cookie: a.cookie,
      params: { id: sb.body!.id },
      body: { name: 'Mine', active: false },
    });
    expect(res.status).toBe(404);
    expect(
      (await pg.query('SELECT name, active FROM "Service" WHERE id = $1', [sb.body!.id])).rows[0],
    ).toEqual({ name: 'B cut', active: true });
    const routeModule = await import('@/app/api/services/[id]/route');
    expect(Object.keys(routeModule)).not.toContain('DELETE');
  });
  it('GET /api/services list never includes business B’s services', async () => {
    const sb = await call(postService, '/api/services', {
      cookie: b.cookie,
      body: { name: 'B cut', durationMin: 30, price: 10 },
    });
    const list = await call(listServices, '/api/services', { cookie: a.cookie });
    expect(list.body!.services).toEqual([]);
    expect(JSON.stringify(list.body)).not.toContain(sb.body!.id);
  });
  it('GET /api/staff never lists B’s staff; PATCH, PUT services/hours and time-off on B’s staff id -> 404', async () => {
    const mb = await call(postStaff, '/api/staff', {
      cookie: b.cookie,
      body: { displayName: 'B person', bookable: true, serviceIds: [] },
    });
    const id = mb.body!.id;
    const list = await call(listStaff, '/api/staff', { cookie: a.cookie });
    expect(JSON.stringify(list.body)).not.toContain(id);
    const opts = { cookie: a.cookie, params: { id } };
    expect(
      (
        await call(patchStaff, `/api/staff/${id}`, {
          ...opts,
          method: 'PATCH',
          body: { active: false },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(putStaffServices, `/api/staff/${id}/services`, {
          ...opts,
          method: 'PUT',
          body: { serviceIds: [] },
        })
      ).status,
    ).toBe(404);
    expect((await call(getHours, `/api/staff/${id}/hours`, opts)).status).toBe(404);
    expect((await call(listTimeOff, `/api/staff/${id}/time-off`, opts)).status).toBe(404);
    expect(
      (await pg.query('SELECT active FROM "StaffMember" WHERE id = $1', [id])).rows[0].active,
    ).toBe(true);
  });
  it.todo('POST /api/appointments with B’s serviceId/staffId/clientId from A’s session -> 404');
});
