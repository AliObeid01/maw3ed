/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are untyped JSON */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { POST as createInvite, GET as listInvites } from '@/app/api/invites/route';
import { POST as acceptInvite } from '@/app/api/invites/[token]/accept/route';
import { GET as getBusiness, PATCH as patchBusiness } from '@/app/api/business/route';
import { GET as listServices, POST as postService } from '@/app/api/services/route';
import { PATCH as patchService } from '@/app/api/services/[id]/route';
import { GET as listStaff, POST as postStaff } from '@/app/api/staff/route';
import { PATCH as patchStaff } from '@/app/api/staff/[id]/route';
import { PUT as putStaffServices } from '@/app/api/staff/[id]/services/route';
import { GET as getHours, PUT as putHours } from '@/app/api/staff/[id]/hours/route';
import { GET as listTimeOff, POST as postTimeOff } from '@/app/api/staff/[id]/time-off/route';
import { DELETE as deleteTimeOff } from '@/app/api/staff/[id]/time-off/[timeOffId]/route';
import { fakeEmailProvider } from '@/server/providers/email';
import { workingHoursRepo } from '@/server/repositories/workingHours.repo';
import { loginThrottle } from '@/server/services/loginThrottle';
import { call, PASSWORD, signup } from './helpers/api';
import { newClient, setupSchema, truncateAll } from './helpers/db';

let pg: Client;
type Tenant = Awaited<ReturnType<typeof signup>>;
let a: Tenant;
let b: Tenant;
let staffCookie: string;

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

/** A STAFF-role session in business A, created through the real invite flow. */
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
const idp = (id: string) => ({ params: { id } });

describe('GET/PATCH /api/business', () => {
  it('returns settings and setup flags that flip as data is added', async () => {
    const first = await call(getBusiness, '/api/business', { cookie: a.cookie });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      id: a.info.business.id,
      slug: 'business-a',
      name: 'Business A',
      timezone: 'Asia/Beirut',
      slotStepMin: 15,
      category: null,
      address: null,
    });
    // Signup creates the owner as a bookable staff row.
    expect(first.body!.setup).toEqual({
      hasServices: false,
      hasBookableStaff: true,
      hasHours: false,
    });
    const ownerRow = (await call(listStaff, '/api/staff', { cookie: a.cookie })).body!.staff[0];
    await call(patchStaff, `/api/staff/${ownerRow.id}`, {
      method: 'PATCH',
      cookie: a.cookie,
      ...idp(ownerRow.id),
      body: { bookable: false },
    });
    expect(
      (await call(getBusiness, '/api/business', { cookie: a.cookie })).body!.setup.hasBookableStaff,
    ).toBe(false);

    await svc(a.cookie);
    const s = (await staff(a.cookie)).body!;
    const afterStaff = await call(getBusiness, '/api/business', { cookie: a.cookie });
    expect(afterStaff.body!.setup).toEqual({
      hasServices: true,
      hasBookableStaff: true,
      hasHours: false,
    });

    await call(putHours, `/api/staff/${s.id}/hours`, {
      method: 'PUT',
      cookie: a.cookie,
      ...idp(s.id),
      body: { intervals: [{ weekday: 1, startLocal: '09:00', endLocal: '17:00' }] },
    });
    const afterHours = await call(getBusiness, '/api/business', { cookie: a.cookie });
    expect(afterHours.body!.setup.hasHours).toBe(true);

    // Hours of a deactivated staff member do not count.
    await call(patchStaff, `/api/staff/${s.id}`, {
      method: 'PATCH',
      cookie: a.cookie,
      ...idp(s.id),
      body: { active: false },
    });
    const afterOff = await call(getBusiness, '/api/business', { cookie: a.cookie });
    expect(afterOff.body!.setup).toMatchObject({ hasBookableStaff: false, hasHours: false });
  });

  it('updates settings, clears nullable fields, and returns the full shape', async () => {
    const res = await call(patchBusiness, '/api/business', {
      method: 'PATCH',
      cookie: a.cookie,
      body: {
        name: 'Studio Nour',
        timezone: 'Europe/Paris',
        slotStepMin: 30,
        bookingWindowDays: 60,
        minNoticeMin: 0,
        cancelCutoffMin: 120,
        category: 'Salon',
        address: 'Hamra',
      },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Studio Nour',
      timezone: 'Europe/Paris',
      slotStepMin: 30,
      bookingWindowDays: 60,
      minNoticeMin: 0,
      cancelCutoffMin: 120,
      category: 'Salon',
      address: 'Hamra',
      slug: 'business-a',
    });
    const cleared = await call(patchBusiness, '/api/business', {
      method: 'PATCH',
      cookie: a.cookie,
      body: { category: null },
    });
    expect(cleared.body!.category).toBeNull();
    expect(cleared.body!.name).toBe('Studio Nour');
    // B is untouched.
    const rb = await call(getBusiness, '/api/business', { cookie: b.cookie });
    expect(rb.body!.name).toBe('Business B');
    expect(rb.body!.timezone).toBe('Asia/Beirut');
  });

  it.each([
    ['invalid IANA timezone', { timezone: 'Mars/Phobos' }, 'timezone'],
    ['slotStepMin 7', { slotStepMin: 7 }, 'slotStepMin'],
    ['empty name', { name: '  ' }, 'name'],
    ['bookingWindowDays 0', { bookingWindowDays: 0 }, 'bookingWindowDays'],
    ['minNoticeMin too large', { minNoticeMin: 10081 }, 'minNoticeMin'],
    ['category too long', { category: 'x'.repeat(41) }, 'category'],
    ['slug is not patchable', { slug: 'stolen' }, 'slug'],
    ['plan is not patchable', { plan: 'PRO' }, 'plan'],
    ['businessId smuggled', { businessId: 'x' }, 'businessId'],
  ])('rejects %s with 400 and fields', async (_name, body, field) => {
    const res = await call(patchBusiness, '/api/business', {
      method: 'PATCH',
      cookie: a.cookie,
      body,
    });
    expect(res.status).toBe(400);
    expect(res.body!.error.code).toBe('VALIDATION_FAILED');
    expect(res.body!.error.fields).toHaveProperty(field);
    const row = (
      await pg.query('SELECT slug, plan FROM "Business" WHERE id = $1', [a.info.business.id])
    ).rows[0];
    expect(row).toEqual({ slug: 'business-a', plan: 'FREE' });
  });

  it('STAFF can read but not write; unauthenticated is 401', async () => {
    staffCookie = await makeStaffSession();
    expect((await call(getBusiness, '/api/business', { cookie: staffCookie })).status).toBe(200);
    const w = await call(patchBusiness, '/api/business', {
      method: 'PATCH',
      cookie: staffCookie,
      body: { name: 'Hacked' },
    });
    expect(w.status).toBe(403);
    expect((await call(getBusiness, '/api/business')).status).toBe(401);
    expect((await call(getBusiness, '/api/business', { cookie: a.cookie })).body!.name).toBe(
      'Business A',
    );
  });
});

describe('services', () => {
  it('create, list (all by default, ordered), patch and soft-deactivate; no DELETE', async () => {
    const created = await svc(a.cookie, { name: 'Zeta', price: 12.5 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'Zeta',
      durationMin: 30,
      bufferMin: 5,
      price: 12.5,
      active: true,
      sortOrder: 0,
    });
    const defaulted = await call(postService, '/api/services', {
      cookie: a.cookie,
      body: { name: 'Alpha', durationMin: 45, price: 0 },
    });
    expect(defaulted.body).toMatchObject({ bufferMin: 0, price: 0 });

    const patched = await call(patchService, `/api/services/${created.body!.id}`, {
      method: 'PATCH',
      cookie: a.cookie,
      ...idp(created.body!.id),
      body: { price: 15.25, active: false, sortOrder: 3, durationMin: 60 },
    });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({
      price: 15.25,
      active: false,
      sortOrder: 3,
      durationMin: 60,
    });

    const list = await call(listServices, '/api/services', { cookie: a.cookie });
    expect(list.body!.services.map((s: any) => s.name)).toEqual(['Alpha', 'Zeta']);
    expect(list.body!.services[1].active).toBe(false);
    const activeOnly = await call(listServices, '/api/services', {
      cookie: a.cookie,
      query: { includeInactive: '0' },
    });
    expect(activeOnly.body!.services.map((s: any) => s.name)).toEqual(['Alpha']);
    const all = await call(listServices, '/api/services', {
      cookie: a.cookie,
      query: { includeInactive: '1' },
    });
    expect(all.body!.services).toHaveLength(2);

    const routeModule = await import('@/app/api/services/[id]/route');
    expect(Object.keys(routeModule)).not.toContain('DELETE');
  });

  it.each([
    ['duration 0', { durationMin: 0 }, 'durationMin'],
    ['duration fractional', { durationMin: 30.5 }, 'durationMin'],
    ['negative price', { price: -1 }, 'price'],
    ['3 decimal price', { price: 1.005 }, 'price'],
    ['negative buffer', { bufferMin: -1 }, 'bufferMin'],
    ['empty name', { name: '' }, 'name'],
    ['unknown field', { colour: 'red' }, 'colour'],
    ['businessId', { businessId: 'x' }, 'businessId'],
  ])('POST rejects %s with 400', async (_n, over, field) => {
    const res = await svc(a.cookie, over);
    expect(res.status).toBe(400);
    expect(res.body!.error.fields).toHaveProperty(field);
    expect((await pg.query('SELECT 1 FROM "Service"')).rowCount).toBe(0);
  });

  it('PATCH rejects bad values and unknown fields', async () => {
    const s = (await svc(a.cookie)).body!;
    for (const body of [{ durationMin: 0 }, { price: -5 }, { id: 'x' }, { sortOrder: 1.5 }]) {
      const res = await call(patchService, `/api/services/${s.id}`, {
        method: 'PATCH',
        cookie: a.cookie,
        ...idp(s.id),
        body,
      });
      expect(res.status).toBe(400);
    }
    const badId = await call(patchService, '/api/services/NOT-AN-ID', {
      method: 'PATCH',
      cookie: a.cookie,
      ...idp('NOT-AN-ID'),
      body: { name: 'x' },
    });
    expect(badId.status).toBe(400);
  });

  it('STAFF can read but every write is 403', async () => {
    const s = (await svc(a.cookie)).body!;
    staffCookie = await makeStaffSession();
    const list = await call(listServices, '/api/services', { cookie: staffCookie });
    expect(list.status).toBe(200);
    expect(list.body!.services).toHaveLength(1);
    expect((await svc(staffCookie)).status).toBe(403);
    const p = await call(patchService, `/api/services/${s.id}`, {
      method: 'PATCH',
      cookie: staffCookie,
      ...idp(s.id),
      body: { price: 1 },
    });
    expect(p.status).toBe(403);
    expect(Number((await pg.query('SELECT price FROM "Service"')).rows[0].price)).toBe(20);
  });

  it('business A gets 404 patching B’s service and never lists it', async () => {
    const sb = (await svc(b.cookie, { name: 'B only' })).body!;
    const res = await call(patchService, `/api/services/${sb.id}`, {
      method: 'PATCH',
      cookie: a.cookie,
      ...idp(sb.id),
      body: { name: 'Mine now', active: false },
    });
    expect(res.status).toBe(404);
    expect(
      (await pg.query('SELECT name, active FROM "Service" WHERE id = $1', [sb.id])).rows[0],
    ).toEqual({ name: 'B only', active: true });
    const list = await call(listServices, '/api/services', { cookie: a.cookie });
    expect(list.body!.services).toEqual([]);
  });
});

describe('staff', () => {
  it('creates a login-less staff member with services; lists role and serviceIds; patches', async () => {
    const s1 = (await svc(a.cookie, { name: 'Cut' })).body!;
    const s2 = (await svc(a.cookie, { name: 'Colour' })).body!;
    const created = await staff(a.cookie, {
      displayName: 'Dr Rami',
      serviceIds: [s1.id, s2.id, s1.id],
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      displayName: 'Dr Rami',
      bookable: true,
      active: true,
      role: null,
    });
    expect([...created.body!.serviceIds].sort()).toEqual([s1.id, s2.id].sort());

    const list = await call(listStaff, '/api/staff', { cookie: a.cookie });
    expect(list.status).toBe(200);
    const owner = list.body!.staff.find((x: any) => x.role === 'OWNER');
    expect(owner).toMatchObject({ bookable: true, active: true, serviceIds: [] });
    expect(list.body!.staff.find((x: any) => x.id === created.body!.id).role).toBeNull();

    const patched = await call(patchStaff, `/api/staff/${created.body!.id}`, {
      method: 'PATCH',
      cookie: a.cookie,
      ...idp(created.body!.id),
      body: { displayName: 'Dr Rami K', bookable: false },
    });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ displayName: 'Dr Rami K', bookable: false });

    // Owners can be non-bookable and bookable again.
    const ownerOff = await call(patchStaff, `/api/staff/${owner.id}`, {
      method: 'PATCH',
      cookie: a.cookie,
      ...idp(owner.id),
      body: { bookable: false },
    });
    expect(ownerOff.body).toMatchObject({ bookable: false, role: 'OWNER' });
    const ownerPatch = await call(patchStaff, `/api/staff/${owner.id}`, {
      method: 'PATCH',
      cookie: a.cookie,
      ...idp(owner.id),
      body: { bookable: true },
    });
    expect(ownerPatch.body).toMatchObject({ bookable: true, role: 'OWNER' });
  });

  it('PUT services replaces the set and returns it', async () => {
    const s1 = (await svc(a.cookie, { name: 'Cut' })).body!;
    const s2 = (await svc(a.cookie, { name: 'Colour' })).body!;
    const m = (await staff(a.cookie, { serviceIds: [s1.id] })).body!;
    const res = await call(putStaffServices, `/api/staff/${m.id}/services`, {
      method: 'PUT',
      cookie: a.cookie,
      ...idp(m.id),
      body: { serviceIds: [s2.id] },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ serviceIds: [s2.id] });
    const rows = (
      await pg.query('SELECT "serviceId" FROM "StaffService" WHERE "staffId" = $1', [m.id])
    ).rows;
    expect(rows).toEqual([{ serviceId: s2.id }]);
    const cleared = await call(putStaffServices, `/api/staff/${m.id}/services`, {
      method: 'PUT',
      cookie: a.cookie,
      ...idp(m.id),
      body: { serviceIds: [] },
    });
    expect(cleared.body).toEqual({ serviceIds: [] });
  });

  it('rejects another business’s service id on create and on PUT (no cross-tenant link)', async () => {
    const sb = (await svc(b.cookie, { name: 'B svc' })).body!;
    const sa = (await svc(a.cookie, { name: 'A svc' })).body!;
    const bad = await staff(a.cookie, { serviceIds: [sa.id, sb.id] });
    expect(bad.status).toBe(400);
    expect(bad.body!.error.fields).toHaveProperty('serviceIds');
    expect(
      (await pg.query('SELECT 1 FROM "StaffMember" WHERE "displayName" = $1', ['Nour'])).rowCount,
    ).toBe(0);

    const m = (await staff(a.cookie, { serviceIds: [sa.id] })).body!;
    const put = await call(putStaffServices, `/api/staff/${m.id}/services`, {
      method: 'PUT',
      cookie: a.cookie,
      ...idp(m.id),
      body: { serviceIds: [sb.id] },
    });
    expect(put.status).toBe(400);
    expect(
      (await pg.query('SELECT "serviceId" FROM "StaffService" WHERE "staffId" = $1', [m.id])).rows,
    ).toEqual([{ serviceId: sa.id }]);
    expect(
      (await pg.query('SELECT 1 FROM "StaffService" WHERE "serviceId" = $1', [sb.id])).rowCount,
    ).toBe(0);
  });

  it('validates bodies (400) and rejects unknown fields', async () => {
    for (const body of [
      { displayName: '', bookable: true, serviceIds: [] },
      { displayName: 'x', serviceIds: [] },
      { displayName: 'x', bookable: true, serviceIds: ['not-an-id'] },
      { displayName: 'x', bookable: true, serviceIds: [], userId: 'u' },
    ]) {
      const res = await call(postStaff, '/api/staff', { cookie: a.cookie, body });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body!.error.fields).length).toBeGreaterThan(0);
    }
    const m = (await staff(a.cookie)).body!;
    const p = await call(patchStaff, `/api/staff/${m.id}`, {
      method: 'PATCH',
      cookie: a.cookie,
      ...idp(m.id),
      body: { colour: '#fff' },
    });
    expect(p.status).toBe(400);
  });

  it('deactivating staff with a future booked appointment is 409; allowed once none is upcoming', async () => {
    const s = (await svc(a.cookie)).body!;
    const m = (await staff(a.cookie, { serviceIds: [s.id] })).body!;
    const bid = a.info.business.id;
    const client = (
      await pg.query(
        `INSERT INTO "Client" (id, "businessId", name, phone, "updatedAt") VALUES ('c1', $1, 'Sara', '+96170000001', now()) RETURNING id`,
        [bid],
      )
    ).rows[0].id;
    const insertAppt = (id: string, startOffset: string, status: string) =>
      pg.query(
        `INSERT INTO "Appointment" (id, "businessId", "clientId", "staffId", "serviceId", "startAt", "endAt", "blockedUntil", status, "updatedAt")
         VALUES ($1, $2, $3, $4, $5, now() + $6::interval, now() + $6::interval + interval '30 minutes', now() + $6::interval + interval '35 minutes', $7::"AppointmentStatus", now())`,
        [id, bid, client, m.id, s.id, startOffset, status],
      );
    await insertAppt('ap-past', '-2 days', 'BOOKED');
    await insertAppt('ap-cancelled', '2 days', 'CANCELLED');
    await insertAppt('ap-future', '1 day', 'CONFIRMED');

    const deactivate = () =>
      call(patchStaff, `/api/staff/${m.id}`, {
        method: 'PATCH',
        cookie: a.cookie,
        ...idp(m.id),
        body: { active: false },
      });
    const blocked = await deactivate();
    expect(blocked.status).toBe(409);
    expect(blocked.body!.error.code).toBe('HAS_FUTURE_APPOINTMENTS');
    expect(
      (await pg.query('SELECT active FROM "StaffMember" WHERE id = $1', [m.id])).rows[0].active,
    ).toBe(true);

    await pg.query(`UPDATE "Appointment" SET status = 'CANCELLED' WHERE id = 'ap-future'`);
    const ok = await deactivate();
    expect(ok.status).toBe(200);
    expect(ok.body!.active).toBe(false);
  });

  it('STAFF can read but every staff write is 403', async () => {
    const m = (await staff(a.cookie)).body!;
    staffCookie = await makeStaffSession();
    const list = await call(listStaff, '/api/staff', { cookie: staffCookie });
    expect(list.status).toBe(200);
    // The invited receptionist appears with role STAFF and is not bookable.
    expect(list.body!.staff.find((x: any) => x.role === 'STAFF')).toMatchObject({
      displayName: 'Reception',
      bookable: false,
    });
    expect((await staff(staffCookie)).status).toBe(403);
    expect(
      (
        await call(patchStaff, `/api/staff/${m.id}`, {
          method: 'PATCH',
          cookie: staffCookie,
          ...idp(m.id),
          body: { active: false },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(putStaffServices, `/api/staff/${m.id}/services`, {
          method: 'PUT',
          cookie: staffCookie,
          ...idp(m.id),
          body: { serviceIds: [] },
        })
      ).status,
    ).toBe(403);
  });

  it('business A gets 404 for B’s staff on PATCH and PUT services, and never lists B’s staff', async () => {
    const sb = (await svc(b.cookie)).body!;
    const mb = (await staff(b.cookie, { displayName: 'B person', serviceIds: [sb.id] })).body!;
    const sa = (await svc(a.cookie)).body!;
    const patch = await call(patchStaff, `/api/staff/${mb.id}`, {
      method: 'PATCH',
      cookie: a.cookie,
      ...idp(mb.id),
      body: { displayName: 'Taken', active: false },
    });
    expect(patch.status).toBe(404);
    const put = await call(putStaffServices, `/api/staff/${mb.id}/services`, {
      method: 'PUT',
      cookie: a.cookie,
      ...idp(mb.id),
      body: { serviceIds: [sa.id] },
    });
    expect(put.status).toBe(404);
    expect(
      (await pg.query('SELECT "displayName", active FROM "StaffMember" WHERE id = $1', [mb.id]))
        .rows[0],
    ).toEqual({ displayName: 'B person', active: true });
    expect(
      (await pg.query('SELECT "serviceId" FROM "StaffService" WHERE "staffId" = $1', [mb.id])).rows,
    ).toEqual([{ serviceId: sb.id }]);
    const list = await call(listStaff, '/api/staff', { cookie: a.cookie });
    expect(JSON.stringify(list.body)).not.toContain(mb.id);
  });
});

describe('working hours', () => {
  const put = (
    cookie: string,
    id: string,
    intervals: unknown,
    extra: Record<string, unknown> = {},
  ) =>
    call(putHours, `/api/staff/${id}/hours`, {
      method: 'PUT',
      cookie,
      ...idp(id),
      body: { intervals, ...extra },
    });
  const iv = (weekday: number, startLocal: string, endLocal: string) => ({
    weekday,
    startLocal,
    endLocal,
  });

  it('replaces all rows, returns them sorted, accepts 24:00, and a second PUT replaces again', async () => {
    const m = (await staff(a.cookie)).body!;
    const first = await put(a.cookie, m.id, [
      iv(2, '13:00', '17:00'),
      iv(1, '09:00', '12:00'),
      iv(2, '09:00', '12:00'),
      iv(6, '10:00', '24:00'),
    ]);
    expect(first.status).toBe(200);
    expect(first.body!.intervals).toEqual([
      iv(1, '09:00', '12:00'),
      iv(2, '09:00', '12:00'),
      iv(2, '13:00', '17:00'),
      iv(6, '10:00', '24:00'),
    ]);
    const got = await call(getHours, `/api/staff/${m.id}/hours`, {
      cookie: a.cookie,
      ...idp(m.id),
    });
    expect(got.body).toEqual(first.body);

    const second = await put(a.cookie, m.id, [iv(0, '08:00', '09:00')]);
    expect(second.body!.intervals).toEqual([iv(0, '08:00', '09:00')]);
    expect(
      (await pg.query('SELECT 1 FROM "WorkingHours" WHERE "staffId" = $1', [m.id])).rowCount,
    ).toBe(1);
    const empty = await put(a.cookie, m.id, []);
    expect(empty.body).toEqual({ intervals: [] });
  });

  it('rejects overlap, end <= start, bad format, too many, with fields.intervals and an index', async () => {
    const m = (await staff(a.cookie)).body!;
    await put(a.cookie, m.id, [iv(1, '09:00', '10:00')]);

    const overlap = await put(a.cookie, m.id, [iv(1, '09:00', '12:00'), iv(1, '11:00', '13:00')]);
    expect(overlap.status).toBe(400);
    expect(overlap.body!.error.fields.intervals).toMatch(/Interval 1/);
    expect(overlap.body!.error.fields).toHaveProperty('intervals.1');

    const dup = await put(a.cookie, m.id, [iv(1, '09:00', '12:00'), iv(1, '09:00', '12:00')]);
    expect(dup.status).toBe(400);

    const reversed = await put(a.cookie, m.id, [iv(1, '09:00', '12:00'), iv(2, '12:00', '12:00')]);
    expect(reversed.status).toBe(400);
    expect(reversed.body!.error.fields['intervals.1']).toBeTruthy();

    const sevenInDay = Array.from({ length: 7 }, (_, k) =>
      iv(3, `${String(k * 3).padStart(2, '0')}:00`, `${String(k * 3 + 1).padStart(2, '0')}:00`),
    );
    expect((await put(a.cookie, m.id, sevenInDay)).status).toBe(400);

    const total = Array.from({ length: 43 }, (_, k) => iv(k % 7, `0${k % 6}:00`, `0${k % 6}:30`));
    expect((await put(a.cookie, m.id, total)).status).toBe(400);

    for (const bad of [
      [iv(7, '09:00', '10:00')],
      [iv(1, '9:00', '10:00')],
      [iv(1, '09:00', '24:01')],
      [iv(1, '24:00', '24:00')],
      [{ ...iv(1, '09:00', '10:00'), extra: 1 }],
    ])
      expect((await put(a.cookie, m.id, bad)).status).toBe(400);
    expect((await put(a.cookie, m.id, [], { businessId: 'x' })).status).toBe(400);

    // Every rejected PUT left the old rows alone.
    expect(
      (
        await pg.query(
          'SELECT weekday, "startLocal", "endLocal" FROM "WorkingHours" WHERE "staffId" = $1',
          [m.id],
        )
      ).rows,
    ).toEqual([iv(1, '09:00', '10:00')]);
  });

  it('is atomic: a failing replace (DB CHECK) leaves the old rows', async () => {
    const m = (await staff(a.cookie)).body!;
    await put(a.cookie, m.id, [iv(1, '09:00', '10:00'), iv(2, '09:00', '10:00')]);
    // Bypass the service validation so the database constraint is what fails, after the delete ran.
    await expect(
      workingHoursRepo.replaceAll(a.info.business.id, m.id, [
        iv(3, '09:00', '10:00'),
        iv(4, '10:00', '09:00'),
      ]),
    ).rejects.toBeTruthy();
    const rows = (
      await pg.query('SELECT weekday FROM "WorkingHours" WHERE "staffId" = $1 ORDER BY weekday', [
        m.id,
      ])
    ).rows;
    expect(rows).toEqual([{ weekday: 1 }, { weekday: 2 }]);
  });

  it('STAFF reads but cannot write; A gets 404 for B’s staff on GET and PUT', async () => {
    const m = (await staff(a.cookie)).body!;
    const mb = (await staff(b.cookie)).body!;
    await put(b.cookie, mb.id, [iv(1, '09:00', '10:00')]);
    staffCookie = await makeStaffSession();
    expect(
      (await call(getHours, `/api/staff/${m.id}/hours`, { cookie: staffCookie, ...idp(m.id) }))
        .status,
    ).toBe(200);
    expect((await put(staffCookie, m.id, [iv(1, '09:00', '10:00')])).status).toBe(403);

    expect(
      (await call(getHours, `/api/staff/${mb.id}/hours`, { cookie: a.cookie, ...idp(mb.id) }))
        .status,
    ).toBe(404);
    expect((await put(a.cookie, mb.id, [iv(2, '09:00', '10:00')])).status).toBe(404);
    expect(
      (await pg.query('SELECT weekday FROM "WorkingHours" WHERE "staffId" = $1', [mb.id])).rows,
    ).toEqual([{ weekday: 1 }]);
  });
});

describe('time off', () => {
  const day = 24 * 3600_000;
  const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
  const post = (cookie: string, id: string, body: unknown) =>
    call(postTimeOff, `/api/staff/${id}/time-off`, { cookie, ...idp(id), body });
  const list = (cookie: string, id: string, query?: Record<string, string>) =>
    call(listTimeOff, `/api/staff/${id}/time-off`, { cookie, ...idp(id), query });

  it('creates, lists future+ongoing by default, past with includePast, and deletes', async () => {
    const m = (await staff(a.cookie)).body!;
    const future = await post(a.cookie, m.id, {
      startAt: at(2 * day),
      endAt: at(3 * day),
      reason: 'VACATION',
    });
    expect(future.status).toBe(201);
    expect(future.body).toMatchObject({ reason: 'VACATION' });
    expect(future.body!.id).toBeTruthy();
    await post(a.cookie, m.id, { startAt: at(-day), endAt: at(day), reason: 'SICK' });
    await post(a.cookie, m.id, { startAt: at(-5 * day), endAt: at(-4 * day), reason: 'OTHER' });

    const def = await list(a.cookie, m.id);
    expect(def.status).toBe(200);
    expect(def.body!.items.map((i: any) => i.reason)).toEqual(['SICK', 'VACATION']);
    const all = await list(a.cookie, m.id, { includePast: '1' });
    expect(all.body!.items.map((i: any) => i.reason)).toEqual(['OTHER', 'SICK', 'VACATION']);

    const del = await call(deleteTimeOff, `/api/staff/${m.id}/time-off/${future.body!.id}`, {
      method: 'DELETE',
      cookie: a.cookie,
      params: { id: m.id, timeOffId: future.body!.id },
    });
    expect(del.status).toBe(204);
    expect((await list(a.cookie, m.id)).body!.items).toHaveLength(1);
    const again = await call(deleteTimeOff, `/api/staff/${m.id}/time-off/${future.body!.id}`, {
      method: 'DELETE',
      cookie: a.cookie,
      params: { id: m.id, timeOffId: future.body!.id },
    });
    expect(again.status).toBe(404);
  });

  it('rejects end <= start, spans over a year, bad dates, bad reason and unknown fields', async () => {
    const m = (await staff(a.cookie)).body!;
    const s = at(day);
    for (const body of [
      { startAt: s, endAt: s, reason: 'OTHER' },
      { startAt: at(2 * day), endAt: s, reason: 'OTHER' },
      { startAt: s, endAt: at(day + 367 * day), reason: 'OTHER' },
      { startAt: 'tomorrow', endAt: at(2 * day), reason: 'OTHER' },
      { startAt: s, endAt: at(2 * day), reason: 'HOLIDAY' },
      { startAt: s, endAt: at(2 * day) },
      { startAt: s, endAt: at(2 * day), reason: 'OTHER', note: 'x' },
    ]) {
      const res = await post(a.cookie, m.id, body);
      expect(res.status).toBe(400);
      expect(Object.keys(res.body!.error.fields).length).toBeGreaterThan(0);
    }
    const ok = await post(a.cookie, m.id, {
      startAt: s,
      endAt: at(day + 365 * day),
      reason: 'OTHER',
    });
    expect(ok.status).toBe(201);
    expect((await pg.query('SELECT 1 FROM "TimeOff"')).rowCount).toBe(1);
  });

  it('STAFF reads but cannot write; A gets 404 for B’s staff and B’s time-off ids', async () => {
    const m = (await staff(a.cookie)).body!;
    const mb = (await staff(b.cookie)).body!;
    const tb = await post(b.cookie, mb.id, {
      startAt: at(day),
      endAt: at(2 * day),
      reason: 'SICK',
    });
    staffCookie = await makeStaffSession();
    expect((await list(staffCookie, m.id)).status).toBe(200);
    expect(
      (await post(staffCookie, m.id, { startAt: at(day), endAt: at(2 * day), reason: 'OTHER' }))
        .status,
    ).toBe(403);
    expect(
      (
        await call(deleteTimeOff, `/api/staff/${m.id}/time-off/x`, {
          method: 'DELETE',
          cookie: staffCookie,
          params: { id: m.id, timeOffId: tb.body!.id },
        })
      ).status,
    ).toBe(403);

    expect((await list(a.cookie, mb.id)).status).toBe(404);
    expect(
      (await post(a.cookie, mb.id, { startAt: at(day), endAt: at(2 * day), reason: 'OTHER' }))
        .status,
    ).toBe(404);
    // B's time-off id under A's own staff id, and under B's staff id, both 404 for A.
    for (const staffId of [m.id, mb.id]) {
      const del = await call(deleteTimeOff, `/api/staff/${staffId}/time-off/${tb.body!.id}`, {
        method: 'DELETE',
        cookie: a.cookie,
        params: { id: staffId, timeOffId: tb.body!.id },
      });
      expect(del.status).toBe(404);
    }
    expect((await pg.query('SELECT 1 FROM "TimeOff" WHERE id = $1', [tb.body!.id])).rowCount).toBe(
      1,
    );
    expect((await list(b.cookie, mb.id)).body!.items).toHaveLength(1);
  });
});

describe('GET /api/invites (pending)', () => {
  it('lists only this business’s pending invites, owner only, without token material', async () => {
    await call(createInvite, '/api/invites', {
      body: { email: 'one@example.test', role: 'STAFF' },
      cookie: a.cookie,
    });
    await call(createInvite, '/api/invites', {
      body: { email: 'two@example.test', role: 'STAFF' },
      cookie: a.cookie,
    });
    await call(createInvite, '/api/invites', {
      body: { email: 'bee@example.test', role: 'STAFF' },
      cookie: b.cookie,
    });
    await pg.query(
      `UPDATE "Invite" SET "expiresAt" = now() - interval '1 hour' WHERE email = 'two@example.test'`,
    );
    await pg.query(
      `INSERT INTO "Invite" (id, "businessId", email, role, "tokenHash", "expiresAt", "acceptedAt") VALUES ('acc', $1, 'done@example.test', 'STAFF', 'h-done', now() + interval '1 day', now())`,
      [a.info.business.id],
    );

    const res = await call(listInvites, '/api/invites', { cookie: a.cookie });
    expect(res.status).toBe(200);
    expect(res.body!.invites).toHaveLength(1);
    expect(res.body!.invites[0]).toMatchObject({ email: 'one@example.test', role: 'STAFF' });
    expect(Object.keys(res.body!.invites[0]).sort()).toEqual(['email', 'expiresAt', 'id', 'role']);
    expect(JSON.stringify(res.body)).not.toContain('bee@example.test');

    staffCookie = await makeStaffSession();
    expect((await call(listInvites, '/api/invites', { cookie: staffCookie })).status).toBe(403);
    expect((await call(listInvites, '/api/invites')).status).toBe(401);
  });
});
