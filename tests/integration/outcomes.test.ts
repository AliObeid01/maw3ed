/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { PATCH as patchOutcome } from '@/app/api/appointments/[id]/outcome/route';
import { POST as postLink } from '@/app/api/links/[token]/route';
import { GET as getQueue } from '@/app/api/outcomes/queue/route';
import { expiryFor, signToken } from '@/server/domain/tokens';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call } from './helpers/api';
import {
  at,
  bookingBody,
  bookPublicly,
  newScenario,
  newTenant,
  NOW,
  type Tenant,
} from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';
import { newStaffCookie, seedAppointment, seedClient } from './helpers/outcomes';

let pg: Client;
let prisma: PrismaClient;
let a: Tenant;
let b: Tenant;
let aScn: Awaited<ReturnType<typeof newScenario>>;
let bScn: Awaited<ReturnType<typeof newScenario>>;
let staffCookie: string;

// NOW = 2 Nov 2026 08:00Z. PAST ended at 06:30Z; ONGOING started 07:45Z (started, not ended); FUTURE starts 3 Nov.
const PAST = '2026-11-02T06:00:00.000Z';
const ONGOING = '2026-11-02T07:45:00.000Z';
const FUTURE = '2026-11-03T09:00:00.000Z';

const mark = (cookie: string | undefined, id: string, body: unknown) =>
  call(patchOutcome, `/api/appointments/${id}/outcome`, {
    method: 'PATCH',
    cookie,
    params: { id },
    body,
  });
const queue = (cookie: string | undefined, query: Record<string, string> = {}) =>
  call(getQueue, '/api/outcomes/queue', { cookie, query });

const counters = async (clientId: string) =>
  (
    await pg.query('SELECT attended, "noShows", "lateCancels" FROM "Client" WHERE id = $1', [
      clientId,
    ])
  ).rows[0] as { attended: number; noShows: number; lateCancels: number };
const apptRow = async (id: string) =>
  (await pg.query('SELECT * FROM "Appointment" WHERE id = $1', [id])).rows[0];

let nextStart = 0;
/** A client plus an appointment at a distinct past time (no staff overlap). */
async function fixture(
  over: Partial<Parameters<typeof seedAppointment>[1]> = {},
  clientOver: Parameters<typeof seedClient>[2] = {},
  tenant = a,
  scn = aScn,
) {
  const client = await seedClient(prisma, tenant.businessId, clientOver);
  const start =
    over.startAt ??
    new Date(Date.parse('2026-10-01T06:00:00Z') + nextStart++ * 3_600_000).toISOString();
  const appt = await seedAppointment(prisma, {
    businessId: tenant.businessId,
    clientId: client.id,
    staffId: scn.staffIds[0]!,
    serviceId: scn.serviceId,
    startAt: start,
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
  await pg.query('DELETE FROM "ReminderJob"');
  await pg.query('DELETE FROM "Appointment"');
  await pg.query('DELETE FROM "Client"');
  vi.setSystemTime(NOW);
  nextStart = 0;
});

describe('PATCH /api/appointments/{id}/outcome: transitions and counters', () => {
  it.each([
    ['ATTENDED', 'BOOKED', { attended: 1, noShows: 0, lateCancels: 0 }],
    ['NO_SHOW', 'BOOKED', { attended: 0, noShows: 1, lateCancels: 0 }],
    ['LATE_CANCEL', 'BOOKED', { attended: 0, noShows: 0, lateCancels: 1 }],
    ['ATTENDED', 'CONFIRMED', { attended: 1, noShows: 0, lateCancels: 0 }],
    ['NO_SHOW', 'CONFIRMED', { attended: 0, noShows: 1, lateCancels: 0 }],
  ] as const)('%s from %s', async (outcome, status, expected) => {
    const { client, appt } = await fixture({ status });
    const res = await mark(a.cookie, appt.id, { outcome });
    expect(res.status).toBe(200);
    expect(res.body!.appointment).toMatchObject({
      id: appt.id,
      status: outcome,
      client: { id: client.id, name: client.name, phone: client.phone, ...expected },
    });
    expect(await counters(client.id)).toEqual(expected);
  });

  it('records who marked it and when, and STAFF may mark', async () => {
    const { appt } = await fixture();
    const me = (await pg.query('SELECT id FROM "User" WHERE email = $1', [a.info.user.email]))
      .rows[0];
    const res = await mark(a.cookie, appt.id, { outcome: 'NO_SHOW' });
    expect(res.status).toBe(200);
    let row = await apptRow(appt.id);
    expect(row.outcomeMarkedById).toBe(me.id);
    expect(new Date(row.outcomeMarkedAt).toISOString()).toBe(NOW.toISOString());

    const second = await fixture();
    expect((await mark(staffCookie, second.appt.id, { outcome: 'ATTENDED' })).status).toBe(200);
    row = await apptRow(second.appt.id);
    expect(row.outcomeMarkedById).not.toBe(me.id);
    expect(row.outcomeMarkedById).not.toBeNull();
  });

  it('an appointment that started but has not ended can already be marked', async () => {
    const { appt } = await fixture({ startAt: ONGOING });
    expect((await mark(a.cookie, appt.id, { outcome: 'ATTENDED' })).status).toBe(200);
  });

  it('a correction moves one count between counters in the same step', async () => {
    const { client, appt } = await fixture();
    await mark(a.cookie, appt.id, { outcome: 'NO_SHOW' });
    expect(await counters(client.id)).toEqual({ attended: 0, noShows: 1, lateCancels: 0 });
    await mark(a.cookie, appt.id, { outcome: 'ATTENDED' });
    expect(await counters(client.id)).toEqual({ attended: 1, noShows: 0, lateCancels: 0 });
    await mark(a.cookie, appt.id, { outcome: 'LATE_CANCEL' });
    expect(await counters(client.id)).toEqual({ attended: 0, noShows: 0, lateCancels: 1 });
    await mark(a.cookie, appt.id, { outcome: 'NO_SHOW' });
    expect(await counters(client.id)).toEqual({ attended: 0, noShows: 1, lateCancels: 0 });
  });

  it('marking the same outcome again is a 200 no-op that does not count twice', async () => {
    const { client, appt } = await fixture();
    expect((await mark(a.cookie, appt.id, { outcome: 'NO_SHOW' })).status).toBe(200);
    const again = await mark(a.cookie, appt.id, { outcome: 'NO_SHOW' });
    expect(again.status).toBe(200);
    expect(again.body!.appointment.status).toBe('NO_SHOW');
    expect(await counters(client.id)).toEqual({ attended: 0, noShows: 1, lateCancels: 0 });
  });

  it('counters never go negative', async () => {
    // An inconsistent row (NO_SHOW with the counter at 0) corrected to ATTENDED must not drive noShows to -1.
    const { client, appt } = await fixture({ status: 'NO_SHOW' }, { noShows: 0 });
    const res = await mark(a.cookie, appt.id, { outcome: 'ATTENDED' });
    expect(res.status).toBe(200);
    expect(await counters(client.id)).toEqual({ attended: 1, noShows: 0, lateCancels: 0 });
  });

  it('a late cancel marked by staff can be corrected to attended', async () => {
    const { client, appt } = await fixture();
    await mark(a.cookie, appt.id, { outcome: 'LATE_CANCEL' });
    expect((await mark(a.cookie, appt.id, { outcome: 'ATTENDED' })).status).toBe(200);
    expect(await counters(client.id)).toEqual({ attended: 1, noShows: 0, lateCancels: 0 });
  });

  it('marking LATE_CANCEL skips the still-pending reminders', async () => {
    const { appt } = await fixture();
    await pg.query(
      `INSERT INTO "ReminderJob" (id, "businessId", "appointmentId", kind, channel, "dueAt", status)
       VALUES ('rj1', $1, $2, 'H24', 'EMAIL', now(), 'PENDING')`,
      [a.businessId, appt.id],
    );
    await mark(a.cookie, appt.id, { outcome: 'LATE_CANCEL' });
    expect(
      (await pg.query(`SELECT status FROM "ReminderJob" WHERE id = 'rj1'`)).rows[0].status,
    ).toBe('SKIPPED');
  });

  it('a future appointment -> 409 NOT_STARTED and nothing changes', async () => {
    const { client, appt } = await fixture({ startAt: FUTURE });
    const res = await mark(a.cookie, appt.id, { outcome: 'ATTENDED' });
    expect(res.status).toBe(409);
    expect(res.body!.error.code).toBe('NOT_STARTED');
    expect((await apptRow(appt.id)).status).toBe('BOOKED');
    expect(await counters(client.id)).toEqual({ attended: 0, noShows: 0, lateCancels: 0 });
  });

  it('a cancelled appointment cannot be marked -> 409 CONFLICT', async () => {
    const { client, appt } = await fixture({ status: 'CANCELLED', cancelledVia: 'LINK' });
    for (const outcome of ['ATTENDED', 'NO_SHOW', 'LATE_CANCEL']) {
      const res = await mark(a.cookie, appt.id, { outcome });
      expect(res.status).toBe(409);
      expect(res.body!.error.code).toBe('CONFLICT');
    }
    expect(await counters(client.id)).toEqual({ attended: 0, noShows: 0, lateCancels: 0 });
  });

  it('a late cancel from the cancel flow is already counted: re-marking it is a no-op, attended is rejected', async () => {
    const { client, appt } = await fixture(
      { status: 'LATE_CANCEL', cancelledVia: 'LINK' },
      { lateCancels: 1 },
    );
    expect((await mark(a.cookie, appt.id, { outcome: 'LATE_CANCEL' })).status).toBe(200);
    expect(await counters(client.id)).toEqual({ attended: 0, noShows: 0, lateCancels: 1 });
    for (const outcome of ['ATTENDED', 'NO_SHOW']) {
      const res = await mark(a.cookie, appt.id, { outcome });
      expect(res.status).toBe(409);
      expect(res.body!.error.code).toBe('CONFLICT');
    }
    expect(await counters(client.id)).toEqual({ attended: 0, noShows: 0, lateCancels: 1 });
    expect((await apptRow(appt.id)).status).toBe('LATE_CANCEL');
  });

  it('a real late cancel through the link counts once, even if staff then marks LATE_CANCEL', async () => {
    const booked = await bookPublicly(
      a.slug,
      bookingBody(aScn.serviceId, aScn.staffIds[0]!, at('07:00')),
    );
    const id = booked.body!.appointment.id as string;
    const token = signToken(
      { a: id, act: 'cancel', exp: expiryFor(new Date(at('07:00'))) },
      process.env.LINK_SECRET!,
    );
    vi.setSystemTime(new Date('2026-11-03T20:00:00Z')); // inside the 24 h cutoff
    const cancelled = await call(postLink, `/api/links/${token}`, {
      params: { token },
      body: { action: 'cancel' },
    });
    expect(cancelled.body!.result).toBe('late_cancelled');
    const clientId = (await apptRow(id)).clientId as string;
    expect((await counters(clientId)).lateCancels).toBe(1);

    vi.setSystemTime(new Date('2026-11-04T09:00:00Z')); // after the start
    expect((await mark(a.cookie, id, { outcome: 'LATE_CANCEL' })).status).toBe(200);
    expect((await counters(clientId)).lateCancels).toBe(1);
  });

  it('two concurrent identical marks count once', async () => {
    const { client, appt } = await fixture();
    const results = await Promise.all([
      mark(a.cookie, appt.id, { outcome: 'NO_SHOW' }),
      mark(staffCookie, appt.id, { outcome: 'NO_SHOW' }),
      mark(a.cookie, appt.id, { outcome: 'NO_SHOW' }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await counters(client.id)).toEqual({ attended: 0, noShows: 1, lateCancels: 0 });
  });

  it('two concurrent conflicting marks leave exactly one counted outcome that matches the status', async () => {
    const { client, appt } = await fixture();
    const results = await Promise.all([
      mark(a.cookie, appt.id, { outcome: 'NO_SHOW' }),
      mark(a.cookie, appt.id, { outcome: 'ATTENDED' }),
    ]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    const c = await counters(client.id);
    expect(c.attended + c.noShows + c.lateCancels).toBe(1);
    const status = (await apptRow(appt.id)).status;
    expect(status === 'ATTENDED' ? c.attended : c.noShows).toBe(1);
  });
});

describe('PATCH /api/appointments/{id}/outcome: validation, roles, tenancy', () => {
  it('400 for a bad outcome, a missing outcome and unknown fields', async () => {
    const { appt } = await fixture();
    for (const body of [
      { outcome: 'MAYBE' },
      {},
      { outcome: 'ATTENDED', clientId: 'x' },
      { outcome: 'ATTENDED', note: 'late' },
    ]) {
      const res = await mark(a.cookie, appt.id, body);
      expect(res.status).toBe(400);
      expect(res.body!.error.code).toBe('VALIDATION_FAILED');
    }
    expect((await apptRow(appt.id)).status).toBe('BOOKED');
  });
  it('400 for a malformed id, 401 without a session', async () => {
    expect((await mark(a.cookie, 'not-a-cuid!', { outcome: 'ATTENDED' })).status).toBe(400);
    const { appt } = await fixture();
    expect((await mark(undefined, appt.id, { outcome: 'ATTENDED' })).status).toBe(401);
  });
  it('another business’s appointment -> 404 and unchanged', async () => {
    const other = await fixture({}, {}, b, bScn);
    const res = await mark(a.cookie, other.appt.id, { outcome: 'NO_SHOW' });
    expect(res.status).toBe(404);
    expect((await apptRow(other.appt.id)).status).toBe('BOOKED');
    expect(await counters(other.client.id)).toEqual({ attended: 0, noShows: 0, lateCancels: 0 });
  });
});

describe('GET /api/outcomes/queue', () => {
  it('lists ended BOOKED/CONFIRMED appointments newest first with the right shape, and marking removes an item', async () => {
    const older = await fixture(
      { startAt: '2026-11-01T06:00:00.000Z' },
      { name: 'Older', noShows: 3 },
    );
    const newer = await fixture({ startAt: PAST, status: 'CONFIRMED' }, { name: 'Newer' });
    // Not in the queue:
    await fixture({ startAt: ONGOING }); // not ended
    await fixture({ startAt: FUTURE });
    await fixture({ status: 'ATTENDED' });
    await fixture({ status: 'NO_SHOW' });
    await fixture({ status: 'CANCELLED' });
    await fixture({ status: 'LATE_CANCEL', cancelledVia: 'LINK' });
    await fixture({}, {}, b, bScn); // other tenant

    const res = await queue(a.cookie);
    expect(res.status).toBe(200);
    expect(res.body!.count).toBe(2);
    expect(res.body!.items.map((i: any) => i.id)).toEqual([newer.appt.id, older.appt.id]);
    expect(res.body!.items[1]).toMatchObject({
      id: older.appt.id,
      startAt: '2026-11-01T06:00:00.000Z',
      endAt: '2026-11-01T06:30:00.000Z',
      service: { id: aScn.serviceId },
      staff: { id: aScn.staffIds[0] },
      client: { id: older.client.id, name: 'Older', phone: older.client.phone, noShows: 3 },
    });

    await mark(a.cookie, newer.appt.id, { outcome: 'ATTENDED' });
    const after = await queue(staffCookie);
    expect(after.body!.count).toBe(1);
    expect(after.body!.items.map((i: any) => i.id)).toEqual([older.appt.id]);
  });

  it('limit caps items but count stays the total; limit is validated', async () => {
    for (let i = 0; i < 5; i++) await fixture();
    const res = await queue(a.cookie, { limit: '2' });
    expect(res.body!.items).toHaveLength(2);
    expect(res.body!.count).toBe(5);
    for (const limit of ['0', '101', 'abc'])
      expect((await queue(a.cookie, { limit })).status).toBe(400);
    expect((await queue(a.cookie, { nope: '1' })).status).toBe(400);
  });

  it('401 without a session; a business with nothing waiting gets an empty queue', async () => {
    expect((await queue(undefined)).status).toBe(401);
    expect((await queue(b.cookie)).body).toEqual({ count: 0, items: [] });
  });
});
