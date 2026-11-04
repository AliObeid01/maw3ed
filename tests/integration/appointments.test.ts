/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { GET as listAppointments, POST as createAppointment } from '@/app/api/appointments/route';
import { GET as getAppointment } from '@/app/api/appointments/[id]/route';
import { POST as cancelAppointment } from '@/app/api/appointments/[id]/cancel/route';
import { POST as bookPublic } from '@/app/api/public/[slug]/bookings/route';
import { GET as publicSlots } from '@/app/api/public/[slug]/slots/route';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call } from './helpers/api';
import {
  at,
  bookAtFrontDesk,
  bookingBody,
  bookPublicly,
  DAY,
  newKey,
  newScenario,
  newTenant,
  NOW,
  type Tenant,
} from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';

let pg: Client;
let prisma: PrismaClient;
let a: Tenant;
let b: Tenant;
let aScn: Awaited<ReturnType<typeof newScenario>>;
let bScn: Awaited<ReturnType<typeof newScenario>>;
let aAppt: string;
let bAppt: string;

beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
  await truncateAll(pg);
  prisma = newPrisma();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  a = await newTenant();
  b = await newTenant();
  aScn = await newScenario(prisma, a);
  bScn = await newScenario(prisma, b);
  aAppt = (await bookPublicly(a.slug, bookingBody(aScn.serviceId, aScn.staffIds[0]!, at('07:00'))))
    .body!.appointment.id;
  bAppt = (await bookPublicly(b.slug, bookingBody(bScn.serviceId, bScn.staffIds[0]!, at('07:00'))))
    .body!.appointment.id;
});
afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await pg.end();
});

const list = (cookie: string | undefined, query: Record<string, string>) =>
  call(listAppointments, '/api/appointments', { cookie, query });
const get = (cookie: string | undefined, id: string) =>
  call(getAppointment, `/api/appointments/${id}`, { cookie, params: { id } });
const cancel = (cookie: string | undefined, id: string) =>
  call(cancelAppointment, `/api/appointments/${id}/cancel`, {
    method: 'POST',
    cookie,
    params: { id },
  });

describe('GET /api/appointments', () => {
  it('lists the day with client history, service and staff, scoped to the session business', async () => {
    const res = await list(a.cookie, { from: DAY, to: DAY });
    expect(res.status).toBe(200);
    expect(res.body!.appointments).toHaveLength(1);
    const row = res.body!.appointments[0];
    expect(row).toMatchObject({
      id: aAppt,
      startAt: at('07:00'),
      endAt: at('07:30'),
      status: 'BOOKED',
      source: 'PUBLIC',
      client: {
        name: 'Client',
        noShows: 0,
        lateCancels: 0,
        phone: expect.stringMatching(/^\+961/),
      },
      service: { id: aScn.serviceId, durationMin: 30, price: 15 },
      staff: { id: aScn.staffIds[0] },
    });
    expect(JSON.stringify(res.body)).not.toContain(bAppt);
    const resB = await list(b.cookie, { from: DAY, to: DAY });
    expect(resB.body!.appointments.map((x: any) => x.id)).toEqual([bAppt]);
  });

  it('filters by staff and by the local day in the business timezone', async () => {
    const mine = await list(a.cookie, { from: DAY, to: DAY, staffId: aScn.staffIds[0]! });
    expect(mine.body!.appointments).toHaveLength(1);
    const otherDay = await list(a.cookie, { from: '2026-11-05', to: '2026-11-05' });
    expect(otherDay.body!.appointments).toEqual([]);
    // another business's staff id -> 404, never an empty 200 that confirms nothing
    expect((await list(a.cookie, { from: DAY, to: DAY, staffId: bScn.staffIds[0]! })).status).toBe(
      404,
    );
  });

  it('accepts 62 days and rejects 63', async () => {
    expect((await list(a.cookie, { from: '2026-11-01', to: '2026-12-31' })).status).toBe(200); // 61
    expect((await list(a.cookie, { from: '2026-11-01', to: '2027-01-01' })).status).toBe(200); // 62
    const res = await list(a.cookie, { from: '2026-11-01', to: '2027-01-02' }); // 63
    expect(res.status).toBe(400);
    expect(res.body!.error.fields.to).toBeTruthy();
  });

  it('401 without a session; 400 for missing or unknown query fields', async () => {
    expect((await list(undefined, { from: DAY, to: DAY })).status).toBe(401);
    const queries: Record<string, string>[] = [
      {},
      { from: DAY },
      { from: 'x', to: DAY },
      { from: DAY, to: DAY, businessId: b.businessId },
      { from: DAY, to: DAY, staffId: 'no!' },
    ];
    for (const query of queries) {
      const res = await list(a.cookie, query);
      expect(res.status, JSON.stringify(query)).toBe(400);
      expect(res.body!.error.code).toBe('VALIDATION_FAILED');
    }
  });
});

describe('GET /api/appointments/{id}', () => {
  it('returns one appointment; another business’s id is 404', async () => {
    const own = await get(a.cookie, aAppt);
    expect(own.status).toBe(200);
    expect(own.body!.appointment.id).toBe(aAppt);
    const foreign = await get(a.cookie, bAppt);
    expect(foreign.status).toBe(404);
    expect(foreign.body!.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(foreign.body)).not.toContain(b.businessId);
  });
  it('400 for a malformed id, 401 without a session, 404 for an unknown id', async () => {
    expect((await get(a.cookie, 'Not An Id!')).status).toBe(400);
    expect((await get(undefined, aAppt)).status).toBe(401);
    expect((await get(a.cookie, 'abcdefghijklmnopqrstuvwx')).status).toBe(404);
  });
});

describe('POST /api/appointments/{id}/cancel: tenant isolation', () => {
  it('A cannot cancel B’s appointment: 404, B’s row and reminder jobs untouched', async () => {
    const res = await cancel(a.cookie, bAppt);
    expect(res.status).toBe(404);
    const row = (await pg.query(`SELECT status FROM "Appointment" WHERE id = $1`, [bAppt])).rows[0];
    expect(row.status).toBe('BOOKED');
    const skipped = await pg.query(
      `SELECT 1 FROM "ReminderJob" WHERE "appointmentId" = $1 AND status = 'SKIPPED'`,
      [bAppt],
    );
    expect(skipped.rowCount).toBe(0);
  });
  it('400 for a malformed id, 401 without a session', async () => {
    expect((await cancel(a.cookie, 'Not An Id!')).status).toBe(400);
    expect((await cancel(undefined, aAppt)).status).toBe(401);
  });
});

describe('POST /api/appointments (front desk)', () => {
  it('creates with the session business and ignores any attempt to name another one', async () => {
    const scn = await newScenario(prisma, a);
    const forged = await call(createAppointment, '/api/appointments', {
      cookie: a.cookie,
      body: {
        ...bookingBody(scn.serviceId, scn.staffIds[0]!, at('08:00')),
        businessId: b.businessId,
      },
    });
    expect(forged.status).toBe(400);
    const res = await bookAtFrontDesk(
      a.cookie,
      bookingBody(scn.serviceId, scn.staffIds[0]!, at('08:00')),
    );
    expect(res.status).toBe(201);
    const row = (
      await pg.query(`SELECT "businessId" FROM "Appointment" WHERE id = $1`, [
        res.body!.appointment.id,
      ])
    ).rows[0];
    expect(row.businessId).toBe(a.businessId);
  });

  it('B’s service or staff from A’s session -> 404 and nothing is written', async () => {
    const before = (await pg.query(`SELECT 1 FROM "Appointment"`)).rowCount;
    const svc = await bookAtFrontDesk(
      a.cookie,
      bookingBody(bScn.serviceId, aScn.staffIds[0]!, at('08:00')),
    );
    const staff = await bookAtFrontDesk(
      a.cookie,
      bookingBody(aScn.serviceId, bScn.staffIds[0]!, at('08:00')),
    );
    expect([svc.status, staff.status]).toEqual([404, 404]);
    expect((await pg.query(`SELECT 1 FROM "Appointment"`)).rowCount).toBe(before);
  });

  it('401 without a session', async () => {
    const res = await bookAtFrontDesk(
      undefined as unknown as string,
      bookingBody(aScn.serviceId, aScn.staffIds[0]!, at('08:00')),
    );
    expect(res.status).toBe(401);
  });

  it('400 for a bad payload and for unknown fields (top level and client)', async () => {
    const good = bookingBody(aScn.serviceId, aScn.staffIds[0]!, at('08:00'));
    const bad: Record<string, unknown>[] = [
      {},
      { ...good, serviceId: 'nope!' },
      { ...good, staffId: 'Some One!' },
      { ...good, staffId: undefined },
      { ...good, startAt: 'tomorrow' },
      { ...good, startAt: '2026-11-04T09:00:00+03:00' },
      { ...good, client: { name: '', phone: '71 123 456' } },
      { ...good, client: { name: 'X', phone: '71 123 456', email: 'not-an-email' } },
      { ...good, client: { name: 'X', phone: '71 123 456', notes: 'allergic' } },
      { ...good, notes: 'hello' },
      { ...good, status: 'CONFIRMED' },
    ];
    for (const body of bad) {
      const res = await call(createAppointment, '/api/appointments', { cookie: a.cookie, body });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body!.error.code).toBe('VALIDATION_FAILED');
      expect(Object.keys(res.body!.error.fields).length).toBeGreaterThan(0);
    }
    const badKey = await bookAtFrontDesk(a.cookie, good, 'short');
    expect(badKey.status).toBe(400);
    expect(badKey.body!.error.fields['idempotency-key']).toBeTruthy();
  });
});

describe('POST /api/public/{slug}/bookings: validation', () => {
  const post = (
    slug: string,
    body: unknown,
    headers: Record<string, string> = { 'idempotency-key': newKey() },
  ) => call(bookPublic, `/api/public/${slug}/bookings`, { params: { slug }, body, headers });

  it('400 when the Idempotency-Key header is missing or malformed', async () => {
    const body = bookingBody(aScn.serviceId, aScn.staffIds[0]!, at('08:00'));
    const missing = await post(a.slug, body, {});
    expect(missing.status).toBe(400);
    expect(missing.body!.error.fields['idempotency-key']).toBeTruthy();
    expect((await post(a.slug, body, { 'idempotency-key': 'short' })).status).toBe(400);
    expect((await post(a.slug, body, { 'idempotency-key': 'has spaces in the key' })).status).toBe(
      400,
    );
  });

  it('F68: 400 with fields[client.email] when the email is missing, blank or invalid', async () => {
    const good = bookingBody(aScn.serviceId, aScn.staffIds[0]!, at('08:00'));
    const count = async () =>
      (await pg.query(`SELECT 1 FROM "Appointment" WHERE "businessId" = $1`, [a.businessId])).rowCount;
    const before = await count();
    for (const email of [undefined, '', '   ', 'not-an-email']) {
      const res = await post(a.slug, { ...good, client: { ...good.client, email } });
      expect(res.status, String(email)).toBe(400);
      expect(res.body!.error.code).toBe('VALIDATION_FAILED');
      expect(res.body!.error.fields['client.email']).toBeTruthy();
    }
    // Nothing was booked by any of them.
    expect(await count()).toBe(before);
  });

  it('F68: the front-desk route still accepts a booking with no email', async () => {
    const body = bookingBody(aScn.serviceId, aScn.staffIds[0]!, at('08:00'), { email: undefined });
    expect('email' in JSON.parse(JSON.stringify(body.client))).toBe(false);
    const res = await bookAtFrontDesk(a.cookie, body);
    expect(res.status).toBe(201);
  });

  it('400 for a bad payload and for unknown fields', async () => {
    const good = bookingBody(aScn.serviceId, aScn.staffIds[0]!, at('08:00'));
    const bad: unknown[] = [
      {},
      { ...good, startAt: 'soon' },
      { ...good, staffId: '' },
      { ...good, client: { name: 'X' } },
      { ...good, client: { name: 'X', phone: '71 123 456', notes: 'x' } },
      { ...good, businessId: b.businessId },
      { ...good, source: 'FRONT_DESK' },
    ];
    for (const body of bad) {
      const res = await post(a.slug, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body!.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('404 for an unknown slug; a body that is not JSON is 400; wrong content type is 415', async () => {
    const good = bookingBody(aScn.serviceId, aScn.staffIds[0]!, at('08:00'));
    expect((await post('no-such-business', good)).status).toBe(404);
    const res = await bookPublic(
      new Request(`http://localhost/api/public/${a.slug}/bookings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': newKey() },
        body: '{nope',
      }),
      { params: Promise.resolve({ slug: a.slug }) },
    );
    expect(res.status).toBe(400);
    const wrong = await bookPublic(
      new Request(`http://localhost/api/public/${a.slug}/bookings`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain', 'idempotency-key': newKey() },
        body: JSON.stringify(good),
      }),
      { params: Promise.resolve({ slug: a.slug }) },
    );
    expect(wrong.status).toBe(415);
  });

  it('a slug of one business never books into another (service ids are checked per business)', async () => {
    const res = await post(a.slug, bookingBody(bScn.serviceId, aScn.staffIds[0]!, at('08:00')));
    expect(res.status).toBe(404);
    const slots = await call(publicSlots, `/api/public/${a.slug}/slots`, {
      params: { slug: a.slug },
      query: { serviceId: bScn.serviceId, from: DAY, to: DAY },
    });
    expect(slots.status).toBe(404);
  });
});
