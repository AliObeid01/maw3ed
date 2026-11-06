/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { POST as postExcuse } from '@/app/api/appointments/[id]/excuse/route';
import { GET as getAppointment } from '@/app/api/appointments/[id]/route';
import { GET as getClient } from '@/app/api/clients/[id]/route';
import { PATCH as patchBusiness } from '@/app/api/business/route';
import { GET as getReport } from '@/app/api/pilot/report/route';
import { normalizePhone } from '@/server/domain/phone';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call } from './helpers/api';
import {
  at,
  bookingBody,
  bookPublicly,
  newPhone,
  newScenario,
  newTenant,
  NOW,
  type Tenant,
} from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';
import { newStaffCookie, seedAppointment, seedClient } from './helpers/outcomes';

// NOW is 2 Nov 2026 08:00Z. Past appointments are seeded directly (the booking engine refuses the past).
let pg: Client;
let prisma: PrismaClient;
let a: Tenant;
let b: Tenant;
let aScn: Awaited<ReturnType<typeof newScenario>>;
let bScn: Awaited<ReturnType<typeof newScenario>>;
let staffCookie: string;

const excuse = (cookie: string | undefined, id: string, body: unknown = {}) =>
  call(postExcuse, `/api/appointments/${id}/excuse`, { method: 'POST', cookie, params: { id }, body });
const counters = async (clientId: string) =>
  (
    await pg.query('SELECT attended, "noShows", "lateCancels" FROM "Client" WHERE id = $1', [
      clientId,
    ])
  ).rows[0] as { attended: number; noShows: number; lateCancels: number };
const apptRow = async (id: string) =>
  (await pg.query('SELECT * FROM "Appointment" WHERE id = $1', [id])).rows[0];

let nextStart = 0;
async function fixture(
  status: Parameters<typeof seedAppointment>[1]['status'],
  clientOver: Parameters<typeof seedClient>[2] = {},
  over: Partial<Parameters<typeof seedAppointment>[1]> = {},
  tenant = a,
  scn = aScn,
) {
  const client = await seedClient(prisma, tenant.businessId, clientOver);
  const appt = await seedAppointment(prisma, {
    businessId: tenant.businessId,
    clientId: client.id,
    staffId: scn.staffIds[0]!,
    serviceId: scn.serviceId,
    startAt: new Date(Date.parse('2026-10-01T06:00:00Z') + nextStart++ * 3_600_000).toISOString(),
    status,
    ...over,
  });
  return { client, appt };
}

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
  for (const t of ['ReminderJob', 'Payment', 'Appointment', 'Client'])
    await pg.query(`DELETE FROM "${t}"`);
  vi.setSystemTime(NOW);
  nextStart = 0;
});

describe('POST /api/appointments/{id}/excuse: transitions and counters', () => {
  it('a NO_SHOW becomes CANCELLED, the no-show counter goes down, the other counters stay', async () => {
    const { client, appt } = await fixture('NO_SHOW', { noShows: 2, attended: 4, lateCancels: 1 });
    const res = await excuse(a.cookie, appt.id);
    expect(res.status).toBe(200);
    expect(res.body!.appointment).toMatchObject({
      id: appt.id,
      status: 'CANCELLED',
      client: { id: client.id, attended: 4, noShows: 1, lateCancels: 1 },
    });
    expect(await counters(client.id)).toEqual({ attended: 4, noShows: 1, lateCancels: 1 });
    const row = await apptRow(appt.id);
    expect(row.status).toBe('CANCELLED');
    expect(row.cancelledVia).toBe('STAFF');
    expect(row.cancelledAt).not.toBeNull();
  });

  it('a LATE_CANCEL set by staff is excused: the late-cancel counter goes down', async () => {
    const { client, appt } = await fixture('LATE_CANCEL', { lateCancels: 1, noShows: 3 });
    expect((await excuse(a.cookie, appt.id)).status).toBe(200);
    expect(await counters(client.id)).toEqual({ attended: 0, noShows: 3, lateCancels: 0 });
  });

  it('a LATE_CANCEL written by the cancel link keeps cancelledVia and cancelledAt truthful', async () => {
    const cancelledAt = new Date('2026-11-01T20:00:00.000Z');
    const { client, appt } = await fixture('LATE_CANCEL', { lateCancels: 1 }, {
      cancelledVia: 'LINK',
    });
    await prisma.appointment.update({ where: { id: appt.id }, data: { cancelledAt } });
    expect((await excuse(a.cookie, appt.id)).status).toBe(200);
    const row = await apptRow(appt.id);
    expect(row.status).toBe('CANCELLED');
    expect(row.cancelledVia).toBe('LINK');
    expect(new Date(row.cancelledAt).toISOString()).toBe(cancelledAt.toISOString());
    expect((await counters(client.id)).lateCancels).toBe(0);
  });

  it('the counter never goes below 0 (a drifted counter stays at 0)', async () => {
    const { client, appt } = await fixture('NO_SHOW', { noShows: 0 });
    expect((await excuse(a.cookie, appt.id)).status).toBe(200);
    expect((await counters(client.id)).noShows).toBe(0);
    expect((await apptRow(appt.id)).status).toBe('CANCELLED');
  });

  it('is idempotent: excusing an already CANCELLED appointment is a 200 no-op', async () => {
    const { client, appt } = await fixture('NO_SHOW', { noShows: 2 });
    expect((await excuse(a.cookie, appt.id)).status).toBe(200);
    const again = await excuse(staffCookie, appt.id);
    expect(again.status).toBe(200);
    expect(again.body!.appointment.status).toBe('CANCELLED');
    expect((await counters(client.id)).noShows).toBe(1);
  });

  it('a normal staff cancellation (CANCELLED from the start) is also a no-op 200 and moves no counter', async () => {
    const { client, appt } = await fixture('CANCELLED', { noShows: 2 });
    expect((await excuse(a.cookie, appt.id)).status).toBe(200);
    expect((await counters(client.id)).noShows).toBe(2);
  });

  it('records who excused and when in the log only: no free text is stored (the row has no reason column)', async () => {
    const { appt } = await fixture('NO_SHOW', { noShows: 1 });
    await excuse(a.cookie, appt.id);
    const cols = (
      await pg.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'Appointment' AND table_schema = current_schema()`,
      )
    ).rows.map((r: any) => r.column_name);
    expect(cols.filter((c: string) => /reason|note|excuse/i.test(c))).toEqual([]);
  });

  it('two concurrent excuses decrement ONCE', async () => {
    const { client, appt } = await fixture('NO_SHOW', { noShows: 3 });
    const results = await Promise.all([
      excuse(a.cookie, appt.id),
      excuse(staffCookie, appt.id),
      excuse(a.cookie, appt.id),
      excuse(staffCookie, appt.id),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect((await counters(client.id)).noShows).toBe(2);
  });

  it('a concurrent correction and excuse never leave a counter out of step with the status', async () => {
    const { client, appt } = await fixture('NO_SHOW', { noShows: 1 });
    const { PATCH } = await import('@/app/api/appointments/[id]/outcome/route');
    const results = await Promise.all([
      excuse(a.cookie, appt.id),
      call(PATCH, `/api/appointments/${appt.id}/outcome`, {
        method: 'PATCH',
        cookie: a.cookie,
        params: { id: appt.id },
        body: { outcome: 'ATTENDED' },
      }),
    ]);
    expect(results.some((r) => r.status === 200)).toBe(true);
    const c = await counters(client.id);
    const status = (await apptRow(appt.id)).status;
    expect(c.noShows).toBe(0);
    expect(c.attended).toBe(status === 'ATTENDED' ? 1 : 0);
  });
});

describe('POST /api/appointments/{id}/excuse: statuses that cannot be excused', () => {
  it.each(['BOOKED', 'CONFIRMED', 'ATTENDED', 'PENDING_PAYMENT'] as const)(
    '%s -> 409 CONFLICT, nothing changes',
    async (status) => {
      const { client, appt } = await fixture(status, { noShows: 1, attended: 1 });
      const res = await excuse(a.cookie, appt.id);
      expect(res.status).toBe(409);
      expect(res.body!.error.code).toBe('CONFLICT');
      expect((await apptRow(appt.id)).status).toBe(status);
      expect(await counters(client.id)).toEqual({ attended: 1, noShows: 1, lateCancels: 0 });
    },
  );
});

describe('POST /api/appointments/{id}/excuse: auth, roles, tenancy, validation', () => {
  it('401 without a session', async () => {
    const { appt } = await fixture('NO_SHOW', { noShows: 1 });
    expect((await excuse(undefined, appt.id)).status).toBe(401);
    expect((await apptRow(appt.id)).status).toBe('NO_SHOW');
  });

  it('OWNER and STAFF may excuse', async () => {
    const one = await fixture('NO_SHOW', { noShows: 1 });
    const two = await fixture('LATE_CANCEL', { lateCancels: 1 });
    expect((await excuse(a.cookie, one.appt.id)).status).toBe(200);
    expect((await excuse(staffCookie, two.appt.id)).status).toBe(200);
  });

  it("another business's appointment is 404 (never 403) and its counters and status are untouched", async () => {
    const { client, appt } = await fixture('NO_SHOW', { noShows: 2 }, {}, b, bScn);
    const res = await excuse(a.cookie, appt.id);
    expect(res.status).toBe(404);
    expect(res.body!.error.code).toBe('NOT_FOUND');
    expect((await apptRow(appt.id)).status).toBe('NO_SHOW');
    expect((await counters(client.id)).noShows).toBe(2);
  });

  it('an unknown id is 404 and a malformed id is 400', async () => {
    expect((await excuse(a.cookie, 'ckzzzzzzzzzzzzzzzzzzzzzzz')).status).toBe(404);
    const bad = await excuse(a.cookie, 'not-an-id');
    expect(bad.status).toBe(400);
    expect(bad.body!.error.code).toBe('VALIDATION_FAILED');
  });

  it('400 for unknown body fields, including a free-text reason (privacy)', async () => {
    const { appt } = await fixture('NO_SHOW', { noShows: 1 });
    for (const body of [{ reason: 'was sick' }, { note: 'x' }, { extra: 1 }]) {
      const res = await excuse(a.cookie, appt.id, body);
      expect(res.status).toBe(400);
      expect(res.body!.error.code).toBe('VALIDATION_FAILED');
    }
    expect((await apptRow(appt.id)).status).toBe('NO_SHOW');
  });
});

describe('consequences of an excuse', () => {
  it('the slot is not touched: the constraint set holds only BOOKED, CONFIRMED and PENDING_PAYMENT', async () => {
    const { appt } = await fixture('NO_SHOW', { noShows: 1 });
    const before = (
      await pg.query(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'appointment_no_overlap'`,
      )
    ).rows[0].def as string;
    expect(before).toMatch(/BOOKED/);
    expect(before).not.toMatch(/NO_SHOW|LATE_CANCEL|CANCELLED/);
    await excuse(a.cookie, appt.id);
    const other = await seedClient(prisma, a.businessId);
    // the appointment stays out of the constraint: the same time can be booked
    await expect(
      seedAppointment(prisma, {
        businessId: a.businessId,
        clientId: other.id,
        staffId: aScn.staffIds[0]!,
        serviceId: aScn.serviceId,
        startAt: appt.startAt.toISOString(),
      }),
    ).resolves.toBeDefined();
  });

  it('the client record, the appointment page and the history show the new numbers', async () => {
    const { client, appt } = await fixture('NO_SHOW', { noShows: 2, attended: 1 });
    await excuse(a.cookie, appt.id);
    const detail = await call(getClient, `/api/clients/${client.id}`, {
      cookie: a.cookie,
      params: { id: client.id },
    });
    expect(detail.body!.client).toMatchObject({ noShows: 1, repeatNoShow: false });
    expect(detail.body!.history.find((h: any) => h.id === appt.id).status).toBe('CANCELLED');
    const page = await call(getAppointment, `/api/appointments/${appt.id}`, {
      cookie: a.cookie,
      params: { id: appt.id },
    });
    expect(page.body!.appointment).toMatchObject({
      status: 'CANCELLED',
      client: { noShows: 1, repeatNoShow: false },
    });
  });

  it('deposit rule: a client at the threshold stops being asked for a deposit after the excuse', async () => {
    const patch = await call(patchBusiness, '/api/business', {
      method: 'PATCH',
      cookie: a.cookie,
      body: { depositEnabled: true, depositThreshold: 1, depositAmount: 5 },
    });
    expect(patch.status).toBe(200);
    const national = newPhone();
    const client = await seedClient(prisma, a.businessId, {
      name: 'Nadia Example',
      phone: normalizePhone(national)!,
      noShows: 1,
    });
    const appt = await seedAppointment(prisma, {
      businessId: a.businessId,
      clientId: client.id,
      staffId: aScn.staffIds[0]!,
      serviceId: aScn.serviceId,
      startAt: '2026-10-20T08:00:00.000Z',
      status: 'NO_SHOW',
    });
    const asked = await bookPublicly(
      a.slug,
      bookingBody(aScn.serviceId, aScn.staffIds[0]!, at('07:00'), { phone: national }),
    );
    expect(asked.status).toBe(201);
    expect(asked.body!.appointment.status).toBe('PENDING_PAYMENT');
    await pg.query('DELETE FROM "Payment"');
    await pg.query(`DELETE FROM "Appointment" WHERE status = 'PENDING_PAYMENT'`);

    expect((await excuse(a.cookie, appt.id)).status).toBe(200);
    const free = await bookPublicly(
      a.slug,
      bookingBody(aScn.serviceId, aScn.staffIds[0]!, at('07:00'), { phone: national }),
    );
    expect(free.status).toBe(201);
    expect(free.body!.appointment.status).toBe('BOOKED');
    expect(free.body!.payUrl).toBeUndefined();
  });

  it('pilot numbers: the excused no-show leaves the no-show numerator and does not enter the rate', async () => {
    vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
    const ok = await fixture('ATTENDED', { attended: 1 });
    const ns = await fixture('NO_SHOW', { noShows: 1 });
    const report = () => call(getReport, '/api/pilot/report', { cookie: a.cookie, query: { weeks: '26' } });
    const before = (await report()).body!.pilot;
    expect(before).toMatchObject({ attended: 1, noShows: 1, noShowRate: 50 });
    expect((await excuse(a.cookie, ns.appt.id)).status).toBe(200);
    const after = (await report()).body!.pilot;
    expect(after).toMatchObject({ attended: 1, noShows: 0, noShowRate: 0, appointments: 1 });
    expect(ok.appt.id).toBeTruthy();
  });
});
