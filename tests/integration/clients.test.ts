/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { GET as listAppointments } from '@/app/api/appointments/route';
import { GET as listClients } from '@/app/api/clients/route';
import { DELETE as deleteClient, GET as getClient } from '@/app/api/clients/[id]/route';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call } from './helpers/api';
import {
  at,
  bookingBody,
  bookPublicly,
  DAY,
  newScenario,
  newTenant,
  NOW,
  type Tenant,
} from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';
import { e164, newStaffCookie, seedAppointment, seedClient } from './helpers/outcomes';

let pg: Client;
let prisma: PrismaClient;
let a: Tenant;
let b: Tenant;
let aScn: Awaited<ReturnType<typeof newScenario>>;
let bScn: Awaited<ReturnType<typeof newScenario>>;
let staffCookie: string;

const list = (cookie: string | undefined, query: Record<string, string> = {}) =>
  call(listClients, '/api/clients', { cookie, query });
const get = (cookie: string | undefined, id: string) =>
  call(getClient, `/api/clients/${id}`, { cookie, params: { id } });
const del = (cookie: string | undefined, id: string) =>
  call(deleteClient, `/api/clients/${id}`, { method: 'DELETE', cookie, params: { id } });
const names = (res: any) => res.body.clients.map((c: any) => c.name);

beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
  await truncateAll(pg);
  prisma = newPrisma();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  a = await newTenant({ businessName: 'Alpha Salon' });
  b = await newTenant({ businessName: 'Beta Clinic' });
  aScn = await newScenario(prisma, a);
  bScn = await newScenario(prisma, b);
  staffCookie = await newStaffCookie(a.cookie);
});
afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await pg.end();
});
beforeEach(async () => {
  await pg.query('DELETE FROM "WaitlistOffer"');
  await pg.query('DELETE FROM "WaitlistEntry"');
  await pg.query('DELETE FROM "ReminderJob"');
  await pg.query('DELETE FROM "Appointment"');
  await pg.query('DELETE FROM "Client"');
  vi.setSystemTime(NOW);
});

describe('GET /api/clients', () => {
  async function seed() {
    const alice = await seedClient(prisma, a.businessId, {
      name: 'Alice Haddad',
      phone: '+96171111111',
      noShows: 2,
      attended: 3,
    });
    const bob = await seedClient(prisma, a.businessId, {
      name: 'bob karam',
      phone: '+96170222222',
      noShows: 0,
      attended: 1,
      email: null,
    });
    const carol = await seedClient(prisma, a.businessId, {
      name: 'Carol Nader',
      phone: '+96103333333',
      noShows: 5,
      lateCancels: 1,
    });
    const dave = await seedClient(prisma, a.businessId, {
      name: 'Dave 100%_x',
      phone: '+96176444444',
      noShows: 1,
    });
    await seedClient(prisma, b.businessId, { name: 'Alice Other Tenant', phone: '+96171111111' });
    // Last visits: bob 3 Oct (latest of two), alice 1 Oct. A cancelled/booked one never counts.
    const mk = (client: { id: string }, startAt: string, status: any) =>
      seedAppointment(prisma, {
        businessId: a.businessId,
        clientId: client.id,
        staffId: aScn.staffIds[0]!,
        serviceId: aScn.serviceId,
        startAt,
        status,
      });
    await mk(alice, '2026-10-01T06:00:00Z', 'ATTENDED');
    await mk(bob, '2026-09-20T06:00:00Z', 'ATTENDED');
    await mk(bob, '2026-10-03T06:00:00Z', 'ATTENDED');
    await mk(bob, '2026-10-10T06:00:00Z', 'NO_SHOW');
    await mk(carol, '2026-10-12T06:00:00Z', 'CANCELLED');
    return { alice, bob, carol, dave };
  }

  it('returns the shape, counters, lastVisitAt and the repeatNoShow flag at the threshold', async () => {
    await seed();
    const res = await list(a.cookie);
    expect(res.status).toBe(200);
    expect(res.body!.nextCursor).toBeNull();
    expect(res.body!.clients).toHaveLength(4);
    const byName = Object.fromEntries(res.body!.clients.map((c: any) => [c.name, c]));
    expect(byName['Alice Haddad']).toMatchObject({
      phone: '+96171111111',
      email: 'seed@example.test',
      attended: 3,
      noShows: 2,
      lateCancels: 0,
      lastVisitAt: '2026-10-01T06:00:00.000Z',
      repeatNoShow: true,
    });
    expect(byName['bob karam']).toMatchObject({
      email: null,
      lastVisitAt: '2026-10-03T06:00:00.000Z',
      repeatNoShow: false,
    });
    expect(byName['Carol Nader']).toMatchObject({
      lastVisitAt: null,
      repeatNoShow: true,
      lateCancels: 1,
    });
    expect(byName['Dave 100%_x']).toMatchObject({ noShows: 1, repeatNoShow: false });
  });

  it('sorts by name (case-insensitive), noShows and recent visit', async () => {
    await seed();
    expect(names(await list(a.cookie))).toEqual([
      'Alice Haddad',
      'bob karam',
      'Carol Nader',
      'Dave 100%_x',
    ]);
    expect(names(await list(a.cookie, { sort: 'noShows' }))).toEqual([
      'Carol Nader',
      'Alice Haddad',
      'Dave 100%_x',
      'bob karam',
    ]);
    expect(names(await list(a.cookie, { sort: 'recent' }))).toEqual([
      'bob karam',
      'Alice Haddad',
      'Carol Nader',
      'Dave 100%_x',
    ]);
  });

  it('search matches the name case-insensitively and the phone digits, and treats % and _ literally', async () => {
    await seed();
    expect(names(await list(a.cookie, { search: 'ALICE' }))).toEqual(['Alice Haddad']);
    expect(names(await list(a.cookie, { search: 'KAR' }))).toEqual(['bob karam']);
    expect(names(await list(a.cookie, { search: '71 111' }))).toEqual(['Alice Haddad']);
    expect(names(await list(a.cookie, { search: '+961 70' }))).toEqual(['bob karam']);
    expect(names(await list(a.cookie, { search: '100%' }))).toEqual(['Dave 100%_x']);
    expect(names(await list(a.cookie, { search: '%' }))).toEqual(['Dave 100%_x']);
    expect(names(await list(a.cookie, { search: 'zzz' }))).toEqual([]);
  });

  it('pages with an opaque cursor without gaps or repeats', async () => {
    await seed();
    const p1 = await list(a.cookie, { limit: '3' });
    expect(names(p1)).toEqual(['Alice Haddad', 'bob karam', 'Carol Nader']);
    expect(p1.body!.nextCursor).toEqual(expect.any(String));
    const p2 = await list(a.cookie, { limit: '3', cursor: p1.body!.nextCursor });
    expect(names(p2)).toEqual(['Dave 100%_x']);
    expect(p2.body!.nextCursor).toBeNull();
    const exact = await list(a.cookie, { limit: '4' });
    expect(exact.body!.nextCursor).toBeNull();
  });

  it('is scoped to the session business and open to STAFF', async () => {
    await seed();
    const mine = await list(staffCookie);
    expect(mine.status).toBe(200);
    expect(JSON.stringify(mine.body)).not.toContain('Other Tenant');
    expect(names(await list(b.cookie))).toEqual(['Alice Other Tenant']);
  });

  it('400 for a bad sort, limit, cursor or unknown param (including businessId); 401 without a session', async () => {
    for (const q of [
      { sort: 'oldest' },
      { limit: '0' },
      { limit: '101' },
      { cursor: '!!!' },
      { businessId: b.businessId },
    ])
      expect((await list(a.cookie, q)).status).toBe(400);
    const forged = await list(a.cookie, { cursor: Buffer.from('xyz').toString('base64url') });
    expect(forged.status).toBe(400);
    expect((await list(undefined)).status).toBe(401);
  });
});

describe('GET /api/clients/{id}', () => {
  it('returns the client and the latest 50 appointments newest first', async () => {
    const c = await seedClient(prisma, a.businessId, { name: 'Hist', attended: 1 });
    // 55 appointments, one every 2 hours, from 1 Sep.
    for (let i = 0; i < 55; i++)
      await seedAppointment(prisma, {
        businessId: a.businessId,
        clientId: c.id,
        staffId: aScn.staffIds[0]!,
        serviceId: aScn.serviceId,
        startAt: new Date(Date.parse('2026-09-01T06:00:00Z') + i * 2 * 3_600_000).toISOString(),
        status: 'ATTENDED',
      });
    const res = await get(staffCookie, c.id);
    expect(res.status).toBe(200);
    expect(res.body!.client).toMatchObject({ id: c.id, name: 'Hist', repeatNoShow: false });
    expect(res.body!.client.createdAt).toEqual(expect.any(String));
    expect(res.body!.history).toHaveLength(50);
    const starts = res.body!.history.map((h: any) => h.startAt);
    expect(starts).toEqual([...starts].sort().reverse());
    expect(res.body!.history[0]).toMatchObject({
      status: 'ATTENDED',
      service: { id: aScn.serviceId },
      staff: { id: aScn.staffIds[0] },
    });
    expect(res.body!.client.lastVisitAt).toBe(starts[0]);
  });

  it('another business’s client -> 404; unknown id -> 404; malformed id -> 400', async () => {
    const other = await seedClient(prisma, b.businessId, { name: 'Bee' });
    const res = await get(a.cookie, other.id);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('Bee');
    expect((await get(a.cookie, 'cmx0000000000000000000000')).status).toBe(404);
    expect((await get(a.cookie, 'nope!')).status).toBe(400);
    expect((await get(undefined, other.id)).status).toBe(401);
  });
});

describe('DELETE /api/clients/{id}', () => {
  const NAME = 'Zahra Privacy';
  const EMAIL = 'zahra.privacy@example.test';

  async function victim() {
    const phone = e164();
    const national = phone.replace('+961', '');
    const booked = await bookPublicly(
      a.slug,
      bookingBody(aScn.serviceId, aScn.staffIds[0]!, at('07:00'), {
        name: NAME,
        phone: national,
        email: EMAIL,
      }),
    );
    expect(booked.status).toBe(201);
    const clientId = (
      await pg.query('SELECT "clientId" FROM "Appointment" WHERE id = $1', [
        booked.body!.appointment.id,
      ])
    ).rows[0].clientId as string;
    const past = await seedAppointment(prisma, {
      businessId: a.businessId,
      clientId,
      staffId: aScn.staffIds[0]!,
      serviceId: aScn.serviceId,
      startAt: '2026-10-20T06:00:00Z',
      status: 'ATTENDED',
    });
    await prisma.client.update({
      where: { id: clientId },
      data: { attended: 4, noShows: 2, lateCancels: 1 },
    });
    const entry = await prisma.waitlistEntry.create({
      data: {
        businessId: a.businessId,
        clientId,
        serviceId: aScn.serviceId,
        fromDate: new Date('2026-11-05T00:00:00Z'),
        toDate: new Date('2026-11-10T00:00:00Z'),
      },
    });
    return {
      phone,
      clientId,
      futureId: booked.body!.appointment.id as string,
      pastId: past.id,
      entryId: entry.id,
    };
  }

  it('anonymises the client, cancels future bookings, skips reminders, closes waitlist entries, keeps history', async () => {
    const v = await victim();
    const res = await del(a.cookie, v.clientId);
    expect(res.status).toBe(204);

    const c = (await pg.query('SELECT * FROM "Client" WHERE id = $1', [v.clientId])).rows[0];
    expect(c).toMatchObject({
      name: 'Deleted client',
      phone: `deleted:${v.clientId}`,
      email: null,
      attended: 4,
      noShows: 2,
      lateCancels: 1,
    });
    const future = (
      await pg.query(
        'SELECT status, "cancelledVia", "cancelledAt" FROM "Appointment" WHERE id = $1',
        [v.futureId],
      )
    ).rows[0];
    expect(future).toMatchObject({ status: 'CANCELLED', cancelledVia: 'STAFF' });
    expect(future.cancelledAt).not.toBeNull();
    expect(
      (await pg.query('SELECT status FROM "Appointment" WHERE id = $1', [v.pastId])).rows[0].status,
    ).toBe('ATTENDED');
    const jobs = (
      await pg.query('SELECT DISTINCT status FROM "ReminderJob" WHERE "appointmentId" = $1', [
        v.futureId,
      ])
    ).rows;
    expect(jobs).toEqual([{ status: 'SKIPPED' }]);
    expect(
      (await pg.query('SELECT status FROM "WaitlistEntry" WHERE id = $1', [v.entryId])).rows[0]
        .status,
    ).toBe('CANCELLED');
  });

  it('leaves no personal data in any table or in the appointment list responses', async () => {
    const v = await victim();
    await del(a.cookie, v.clientId);
    const tables = (
      await pg.query(`SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`)
    ).rows.map((r) => r.tablename as string);
    for (const t of tables) {
      if (t === 'User' || t === 'Business') continue; // the owner's own account, not the client's
      const dump = (
        await pg.query(
          `SELECT coalesce(string_agg(row_to_json(x)::text, ' '), '') AS s FROM "${t}" x`,
        )
      ).rows[0].s as string;
      for (const pii of [NAME, EMAIL, v.phone, v.phone.replace('+961', '')])
        expect(dump, `${t} still contains ${pii}`).not.toContain(pii);
    }
    const appts = await call(listAppointments, '/api/appointments', {
      cookie: a.cookie,
      query: { from: '2026-10-01', to: '2026-11-30' },
    });
    expect(appts.status).toBe(200);
    const text = JSON.stringify(appts.body);
    for (const pii of [NAME, EMAIL, v.phone]) expect(text).not.toContain(pii);
    expect(text).toContain('Deleted client');
    const detail = await get(a.cookie, v.clientId);
    expect(detail.status).toBe(404);
    expect(names(await list(a.cookie))).toEqual([]);
  });

  it('frees the slot and lets the phone be reused by a new client', async () => {
    const v = await victim();
    await del(a.cookie, v.clientId);
    const again = await bookPublicly(
      a.slug,
      bookingBody(aScn.serviceId, aScn.staffIds[0]!, at('07:00'), {
        name: 'New Person',
        phone: v.phone.replace('+961', ''),
      }),
    );
    expect(again.status).toBe(201);
    const rows = (await pg.query('SELECT id, name FROM "Client" WHERE phone = $1', [v.phone])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(v.clientId);
    expect(rows[0].name).toBe('New Person');
  });

  it('STAFF -> 403 and nothing changes; no session -> 401', async () => {
    const v = await victim();
    expect((await del(staffCookie, v.clientId)).status).toBe(403);
    expect((await del(undefined, v.clientId)).status).toBe(401);
    expect(
      (await pg.query('SELECT name FROM "Client" WHERE id = $1', [v.clientId])).rows[0].name,
    ).toBe(NAME);
    expect(
      (await pg.query('SELECT status FROM "Appointment" WHERE id = $1', [v.futureId])).rows[0]
        .status,
    ).toBe('BOOKED');
  });

  it('another business -> 404 and untouched; deleting twice -> 404; malformed id -> 400', async () => {
    const other = await seedClient(prisma, b.businessId, {
      name: 'Keep Me',
      email: 'keep@example.test',
    });
    const res = await del(a.cookie, other.id);
    expect(res.status).toBe(404);
    expect(
      (await pg.query('SELECT name, email FROM "Client" WHERE id = $1', [other.id])).rows[0],
    ).toEqual({
      name: 'Keep Me',
      email: 'keep@example.test',
    });
    const v = await victim();
    expect((await del(a.cookie, v.clientId)).status).toBe(204);
    expect((await del(a.cookie, v.clientId)).status).toBe(404);
    expect((await del(a.cookie, 'bad id')).status).toBe(400);
  });

  it('does not touch the same phone in another business', async () => {
    const v = await victim();
    const twin = await seedClient(prisma, b.businessId, { name: 'Twin', phone: v.phone });
    await del(a.cookie, v.clientId);
    expect(
      (await pg.query('SELECT name, phone FROM "Client" WHERE id = $1', [twin.id])).rows[0],
    ).toEqual({
      name: 'Twin',
      phone: v.phone,
    });
  });
});

describe('appointment list items carry client.repeatNoShow', () => {
  it('is additive: existing fields stay, the flag follows the threshold', async () => {
    const c = await seedClient(prisma, a.businessId, { noShows: 2 });
    const d = await seedClient(prisma, a.businessId, { noShows: 1 });
    for (const [i, client] of [c, d].entries())
      await seedAppointment(prisma, {
        businessId: a.businessId,
        clientId: client.id,
        staffId: aScn.staffIds[0]!,
        serviceId: aScn.serviceId,
        startAt: at(`0${i + 7}:00`),
      });
    const res = await call(listAppointments, '/api/appointments', {
      cookie: a.cookie,
      query: { from: DAY, to: DAY },
    });
    const flags = res.body!.appointments.map((x: any) => [
      x.client.noShows,
      x.client.repeatNoShow,
      x.client.lateCancels,
    ]);
    expect(flags).toEqual([
      [2, true, 0],
      [1, false, 0],
    ]);
    void bScn;
  });
});
