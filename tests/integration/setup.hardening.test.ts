/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are untyped JSON */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { POST as createInvite } from '@/app/api/invites/route';
import { POST as acceptInvite } from '@/app/api/invites/[token]/accept/route';
import { PATCH as patchBusiness } from '@/app/api/business/route';
import { POST as postService } from '@/app/api/services/route';
import { POST as postStaff } from '@/app/api/staff/route';
import { PATCH as patchStaff } from '@/app/api/staff/[id]/route';
import { PUT as putStaffServices } from '@/app/api/staff/[id]/services/route';
import { PUT as putHours } from '@/app/api/staff/[id]/hours/route';
import { fakeEmailProvider } from '@/server/providers/email';
import { loginThrottle } from '@/server/services/loginThrottle';
import { call, PASSWORD, signup } from './helpers/api';
import { newClient, setupSchema, truncateAll } from './helpers/db';

let pg: Client;
type Tenant = Awaited<ReturnType<typeof signup>>;
let a: Tenant;
let b: Tenant;

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

const idp = (id: string) => ({ params: { id } });
const svc = (cookie: string, over: Record<string, unknown> = {}) =>
  call(postService, '/api/services', {
    cookie,
    body: { name: 'Haircut', durationMin: 30, bufferMin: 5, price: 20, ...over },
  });
const staff = (cookie: string, over: Record<string, unknown> = {}) =>
  call(postStaff, '/api/staff', {
    cookie,
    body: { displayName: 'Nour', bookable: true, serviceIds: [], ...over },
  });
const iv = (weekday: number, startLocal: string, endLocal: string) => ({
  weekday,
  startLocal,
  endLocal,
});
const putH = (id: string, intervals: unknown) =>
  call(putHours, `/api/staff/${id}/hours`, {
    method: 'PUT',
    cookie: a.cookie,
    ...idp(id),
    body: { intervals },
  });
const putS = (id: string, serviceIds: string[]) =>
  call(putStaffServices, `/api/staff/${id}/services`, {
    method: 'PUT',
    cookie: a.cookie,
    ...idp(id),
    body: { serviceIds },
  });

async function makeStaffSession() {
  const inv = await call(createInvite, '/api/invites', {
    body: { email: 'recep@example.test', role: 'STAFF' },
    cookie: a.cookie,
  });
  const token = inv.body!.acceptUrl.split('/invite/')[1];
  const res = await call(acceptInvite, `/api/invites/${token}/accept`, {
    body: { name: 'Reception', password: PASSWORD },
    params: { token },
  });
  expect(res.status).toBe(200);
  return res.cookie as string;
}

describe('concurrency', () => {
  it('concurrent PUT hours with different sets leaves exactly one set, never a union', async () => {
    const m = (await staff(a.cookie)).body!;
    const setA = [iv(1, '09:00', '12:00'), iv(2, '09:00', '12:00'), iv(3, '09:00', '12:00')];
    const setB = [iv(1, '10:00', '14:00'), iv(4, '08:00', '11:00')];
    const key = (rows: any[]) =>
      rows
        .map((r) => `${r.weekday}|${r.startLocal}|${r.endLocal}`)
        .sort()
        .join(',');
    for (let round = 0; round < 8; round++) {
      const [r1, r2] = await Promise.all([putH(m.id, setA), putH(m.id, setB)]);
      expect([r1.status, r2.status]).toEqual([200, 200]);
      const rows = (
        await pg.query(
          'SELECT weekday, "startLocal", "endLocal" FROM "WorkingHours" WHERE "staffId" = $1',
          [m.id],
        )
      ).rows;
      expect([key(setA), key(setB)]).toContain(key(rows));
    }
  });

  it('concurrent PUT services serialise: one of the two sets remains and neither call fails', async () => {
    const s1 = (await svc(a.cookie, { name: 'One' })).body!;
    const s2 = (await svc(a.cookie, { name: 'Two' })).body!;
    const s3 = (await svc(a.cookie, { name: 'Three' })).body!;
    const m = (await staff(a.cookie)).body!;
    for (let round = 0; round < 8; round++) {
      const [r1, r2] = await Promise.all([putS(m.id, [s1.id, s2.id]), putS(m.id, [s2.id, s3.id])]);
      expect([r1.status, r2.status]).toEqual([200, 200]);
      const ids = (
        await pg.query('SELECT "serviceId" FROM "StaffService" WHERE "staffId" = $1', [m.id])
      ).rows
        .map((r) => r.serviceId)
        .sort();
      expect([[s1.id, s2.id].sort(), [s2.id, s3.id].sort()]).toContainEqual(ids);
    }
  });
});

describe('hardening', () => {
  it('an appointment in progress also blocks deactivation (endAt > now)', async () => {
    const s = (await svc(a.cookie)).body!;
    const m = (await staff(a.cookie, { serviceIds: [s.id] })).body!;
    const bid = a.info.business.id;
    await pg.query(
      `INSERT INTO "Client" (id, "businessId", name, phone, "updatedAt") VALUES ('c2', $1, 'Sara', '+96170000002', now())`,
      [bid],
    );
    await pg.query(
      `INSERT INTO "Appointment" (id, "businessId", "clientId", "staffId", "serviceId", "startAt", "endAt", "blockedUntil", status, "updatedAt")
       VALUES ('ap-now', $1, 'c2', $2, $3, now() - interval '10 minutes', now() + interval '20 minutes', now() + interval '25 minutes', 'BOOKED', now())`,
      [bid, m.id, s.id],
    );
    const res = await call(patchStaff, `/api/staff/${m.id}`, {
      method: 'PATCH',
      cookie: a.cookie,
      ...idp(m.id),
      body: { active: false },
    });
    expect(res.status).toBe(409);
    expect(res.body!.error.code).toBe('HAS_FUTURE_APPOINTMENTS');
  });

  it('rejects timezone case variants and offsets; accepts canonical names', async () => {
    for (const timezone of ['asia/beirut', '+03:00', 'UTC+3']) {
      const res = await call(patchBusiness, '/api/business', {
        method: 'PATCH',
        cookie: a.cookie,
        body: { timezone },
      });
      expect(res.status).toBe(400);
      expect(res.body!.error.fields).toHaveProperty('timezone');
    }
    const ok = await call(patchBusiness, '/api/business', {
      method: 'PATCH',
      cookie: a.cookie,
      body: { timezone: 'Europe/Paris' },
    });
    expect(ok.body!.timezone).toBe('Europe/Paris');
  });

  it('prices: 0.1+0.2 accepted, 1e-9 rejected, -0 stored as 0', async () => {
    expect((await svc(a.cookie, { price: 0.1 + 0.2 })).body!.price).toBe(0.3);
    expect((await svc(a.cookie, { price: 1e-9 })).status).toBe(400);
    const raw = await postService(
      new Request('http://localhost/api/services', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: a.cookie },
        body: '{"name":"Free","durationMin":30,"price":-0}',
      }),
    );
    expect(raw.status).toBe(201);
    expect(Object.is((await raw.json()).price, 0)).toBe(true);
  });

  it('oversized body is 413', async () => {
    const res = await postService(
      new Request('http://localhost/api/services', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: a.cookie },
        body: JSON.stringify({ name: 'x'.repeat(70_000), durationMin: 30, price: 1 }),
      }),
    );
    expect(res.status).toBe(413);
  });

  it('a STAFF session sending role or businessId in a write body is refused and writes nothing', async () => {
    const staffCookie = await makeStaffSession();
    const m = (await staff(a.cookie)).body!;
    const attempts = [
      call(postStaff, '/api/staff', {
        cookie: staffCookie,
        body: { displayName: 'smuggled', bookable: true, serviceIds: [], role: 'OWNER' },
      }),
      call(patchStaff, `/api/staff/${m.id}`, {
        method: 'PATCH',
        cookie: staffCookie,
        ...idp(m.id),
        body: { active: false, businessId: b.info.business.id },
      }),
      call(patchBusiness, '/api/business', {
        method: 'PATCH',
        cookie: staffCookie,
        body: { name: 'x', role: 'OWNER' },
      }),
    ];
    for (const r of await Promise.all(attempts)) expect([400, 403]).toContain(r.status);
    expect(
      (await pg.query(`SELECT 1 FROM "StaffMember" WHERE "displayName" = 'smuggled'`)).rowCount,
    ).toBe(0);
    expect((await pg.query(`SELECT 1 FROM "Membership" WHERE role = 'OWNER'`)).rowCount).toBe(2);
    expect(
      (await pg.query('SELECT active FROM "StaffMember" WHERE id = $1', [m.id])).rows[0].active,
    ).toBe(true);
  });
});
