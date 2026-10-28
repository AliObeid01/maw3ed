import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { POST as createInvite } from '@/app/api/invites/route';
import { GET as previewInvite } from '@/app/api/invites/[token]/route';
import { GET as me } from '@/app/api/me/route';
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
  it.todo('PATCH/DELETE /api/services/{id} cross-tenant -> 404');
  it.todo('GET /api/services list never includes business B’s services');
  it.todo('GET/PATCH /api/staff/{id} cross-tenant -> 404');
  it.todo('POST /api/appointments with B’s serviceId/staffId/clientId from A’s session -> 404');
});
