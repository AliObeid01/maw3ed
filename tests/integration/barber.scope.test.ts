/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { POST as cancelAppt } from '@/app/api/appointments/[id]/cancel/route';
import { PATCH as patchContact } from '@/app/api/appointments/[id]/contact/route';
import { POST as excuseAppt } from '@/app/api/appointments/[id]/excuse/route';
import { PATCH as patchOutcome } from '@/app/api/appointments/[id]/outcome/route';
import { GET as getAppt } from '@/app/api/appointments/[id]/route';
import { GET as listClients } from '@/app/api/clients/route';
import { GET as getSummary } from '@/app/api/dashboard/summary/route';
import { GET as getToday } from '@/app/api/dashboard/today/route';
import { GET as getQueue } from '@/app/api/outcomes/queue/route';
import { DELETE as turnOff } from '@/app/api/staff/[id]/login/route';
import { PATCH as patchStaff } from '@/app/api/staff/[id]/route';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call } from './helpers/api';
import { newScenario, newTenant, NOW, type Tenant } from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';
import { seedAppointment, seedClient } from './helpers/outcomes';
import { activatedPractitioner } from './helpers/practitioner';

/**
 * PR-5: the barber's scoped routes. Two barbers A and B in business X, a barber C in business Y. A barber sees and
 * marks only the appointments of the staff member their login is linked to; anything else is a 404 (never a 403,
 * never data), and no response ever carries a client e-mail, a surname or another person's counters.
 */
let pg: Client;
let prisma: PrismaClient;
let x: Tenant;
let y: Tenant;
let xScn: Awaited<ReturnType<typeof newScenario>>;
let yScn: Awaited<ReturnType<typeof newScenario>>;
let A: Awaited<ReturnType<typeof activatedPractitioner>>;
let B: Awaited<ReturnType<typeof activatedPractitioner>>;
let C: Awaited<ReturnType<typeof activatedPractitioner>>;

// NOW = 2 Nov 2026 08:00Z (10:00 in Beirut). ENDED 06:00-06:30Z, STARTED 07:57Z (3 min ago), LONG 07:00-09:00Z.
const DAY = '2026-11-02';
const ENDED = '2026-11-02T06:00:00.000Z';
const STARTED = '2026-11-02T07:57:00.000Z';
const FUTURE = '2026-11-02T12:00:00.000Z';

const today = (cookie: string | undefined, query: Record<string, string> = { date: DAY }) =>
  call(getToday, '/api/dashboard/today', { cookie, query });
const queue = (cookie: string | undefined, query: Record<string, string> = {}) =>
  call(getQueue, '/api/outcomes/queue', { cookie, query });
const detail = (cookie: string | undefined, id: string) =>
  call(getAppt, `/api/appointments/${id}`, { cookie, params: { id } });
const mark = (cookie: string | undefined, id: string, body: unknown) =>
  call(patchOutcome, `/api/appointments/${id}/outcome`, {
    method: 'PATCH',
    cookie,
    params: { id },
    body,
  });
const counters = async (clientId: string) =>
  (
    await pg.query('SELECT attended, "noShows", "lateCancels" FROM "Client" WHERE id = $1', [
      clientId,
    ])
  ).rows[0] as { attended: number; noShows: number; lateCancels: number };
const status = async (id: string) =>
  (await pg.query('SELECT status FROM "Appointment" WHERE id = $1', [id])).rows[0].status as string;

async function appt(
  staffId: string,
  tenant: Tenant,
  scn: typeof xScn,
  over: Partial<Parameters<typeof seedAppointment>[1]> & {
    name?: string;
    email?: string;
    noShows?: number;
  } = {},
) {
  const { name, email, noShows, ...rest } = over;
  const client = await seedClient(prisma, tenant.businessId, {
    name: name ?? 'Rana Haddad',
    email: email ?? 'rana.haddad@example.test',
    noShows: noShows ?? 4,
  });
  const a = await seedAppointment(prisma, {
    businessId: tenant.businessId,
    clientId: client.id,
    staffId,
    serviceId: scn.serviceId,
    startAt: ENDED,
    ...rest,
  });
  return { client, appt: a };
}

beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
  await truncateAll(pg);
  prisma = newPrisma();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  x = await newTenant({ businessName: 'Studio X' });
  y = await newTenant({ businessName: 'Studio Y' });
  xScn = await newScenario(prisma, x);
  yScn = await newScenario(prisma, y);
  // The link route is rate limited per owner (20 an hour): create the shared barbers once.
  A = await activatedPractitioner(x, '+96170000001', 'Barber A');
  B = await activatedPractitioner(x, '+96170000002', 'Barber B');
  C = await activatedPractitioner(y, '+96170000003', 'Barber C');
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
});

describe('GET /api/dashboard/today as a barber', () => {
  it('returns only the barber own appointments and never a surname, e-mail or counter', async () => {
    const mine = await appt(A.staffId, x, xScn);
    const mine2 = await appt(A.staffId, x, xScn, { startAt: FUTURE, status: 'CONFIRMED' });
    const theirs = await appt(B.staffId, x, xScn, { name: 'Karim Saad', email: 'karim@example.test' });
    const other = await appt(C.staffId, y, yScn, { name: 'Dana Mir', email: 'dana@example.test' });
    const ownerStaff = await appt(xScn.staffIds[0]!, x, xScn, { name: 'Zed Walker' });

    const res = await today(A.cookie);
    expect(res.status).toBe(200);
    const ids = res.body!.appointments.map((r: any) => r.id);
    expect(ids).toEqual([mine.appt.id, mine2.appt.id]);
    for (const hidden of [theirs, other, ownerStaff]) expect(ids).not.toContain(hidden.appt.id);
    expect(res.body!.staff).toEqual([{ id: A.staffId, displayName: 'Barber A' }]);
    expect(res.body!.appointments[0].client).toEqual({ name: 'Rana', phone: mine.client.phone });

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('@');
    for (const secret of ['Haddad', 'Saad', 'Mir', 'Walker', 'karim', 'dana', 'noShows', 'repeatNoShow'])
      expect(raw).not.toContain(secret);
    // Owner-only stats and badges are not part of the barber's day.
    expect(res.body!.stats).toEqual({ appointments: 2 });
    expect(res.body).not.toHaveProperty('whatsappDue');
    expect(res.body!.outcomesToMark).toBe(1);
  });

  it('the owner view keeps its full shape and sees every barber', async () => {
    const mine = await appt(A.staffId, x, xScn);
    const theirs = await appt(B.staffId, x, xScn, { name: 'Karim Saad' });
    const res = await today(x.cookie);
    expect(res.status).toBe(200);
    expect(res.body!.appointments.map((r: any) => r.id).sort()).toEqual(
      [mine.appt.id, theirs.appt.id].sort(),
    );
    expect(res.body!.appointments[0].client).toMatchObject({ noShows: 4, repeatNoShow: true });
    expect(res.body!.stats).toHaveProperty('refilledFromWaitlist');
  });

  it('400 on a bad date or an unknown field, 401 without a session', async () => {
    const bad = await today(A.cookie, { date: 'tomorrow' });
    expect(bad.status).toBe(400);
    expect(bad.body!.error.fields.date).toBeTruthy();
    expect((await today(A.cookie, { date: DAY, staffId: B.staffId })).status).toBe(400);
    expect((await today(undefined)).status).toBe(401);
  });
});

describe('GET /api/outcomes/queue as a barber', () => {
  it('lists and counts only the barber own appointments to mark', async () => {
    const mine = await appt(A.staffId, x, xScn);
    await appt(A.staffId, x, xScn, { startAt: FUTURE });
    await appt(B.staffId, x, xScn, { name: 'Karim Saad', email: 'karim@example.test' });
    await appt(C.staffId, y, yScn, { name: 'Dana Mir' });
    const res = await queue(A.cookie);
    expect(res.status).toBe(200);
    expect(res.body!.count).toBe(1);
    expect(res.body!.items).toHaveLength(1);
    expect(res.body!.items[0]).toMatchObject({ id: mine.appt.id, client: { name: 'Rana' } });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('@');
    expect(raw).not.toContain('Haddad');
    expect(raw).not.toContain('noShows');
    // The owner still counts everything in the business.
    expect((await queue(x.cookie)).body!.count).toBe(2);
  });

  it('400 on a bad limit, 401 without a session', async () => {
    expect((await queue(A.cookie, { limit: '0' })).status).toBe(400);
    expect((await queue(A.cookie, { staffId: B.staffId })).status).toBe(400);
    expect((await queue(undefined)).status).toBe(401);
  });
});

describe('GET /api/appointments/{id} as a barber', () => {
  it('shows first name, phone, service, time, status and the confirmation, nothing else about the client', async () => {
    const mine = await appt(A.staffId, x, xScn, {
      status: 'CONFIRMED',
      confirmedAt: new Date('2026-11-01T10:00:00Z'),
    });
    await pg.query(
      `UPDATE "Appointment" SET "contactEmail" = 'override@example.test', "contactName" = 'Override Person' WHERE id = $1`,
      [mine.appt.id],
    );
    const res = await detail(A.cookie, mine.appt.id);
    expect(res.status).toBe(200);
    const a = res.body!.appointment;
    expect(a).toMatchObject({
      id: mine.appt.id,
      status: 'CONFIRMED',
      client: { name: 'Rana', phone: mine.client.phone },
      staff: { id: A.staffId },
    });
    expect(a.confirmedAt).toBeTruthy();
    expect(a.service.name).toBeTruthy();
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('@');
    for (const secret of ['Haddad', 'Override', 'reminderEmail', 'contactEmail', 'noShows', 'lateCancels', 'price'])
      expect(raw).not.toContain(secret);
  });

  it('another barber, another business and a missing id are all the same 404', async () => {
    const theirs = await appt(B.staffId, x, xScn);
    const other = await appt(C.staffId, y, yScn);
    const unknown = 'a'.repeat(24);
    for (const id of [theirs.appt.id, other.appt.id, unknown]) {
      const res = await detail(A.cookie, id);
      expect(res.status).toBe(404);
      expect(res.body!.error.code).toBe('NOT_FOUND');
      expect(JSON.stringify(res.body)).not.toContain('Rana');
    }
    // Owner of X sees B's appointment but not Y's.
    expect((await detail(x.cookie, theirs.appt.id)).status).toBe(200);
    expect((await detail(x.cookie, other.appt.id)).status).toBe(404);
  });

  it('400 on a malformed id, 401 without a session', async () => {
    expect((await detail(A.cookie, 'not-an-id')).status).toBe(400);
    expect((await detail(undefined, 'a'.repeat(24))).status).toBe(401);
  });
});

describe('PATCH /api/appointments/{id}/outcome as a barber', () => {
  it('marks an own ended appointment once; the client counters change once', async () => {
    const mine = await appt(A.staffId, x, xScn, { noShows: 0 });
    const res = await mark(A.cookie, mine.appt.id, { outcome: 'ATTENDED' });
    expect(res.status).toBe(200);
    expect(res.body!.appointment).toMatchObject({ id: mine.appt.id, status: 'ATTENDED' });
    expect(res.body!.appointment.client).toEqual({ name: 'Rana', phone: mine.client.phone });
    expect(JSON.stringify(res.body)).not.toContain('@');
    const again = await mark(A.cookie, mine.appt.id, { outcome: 'ATTENDED' });
    expect(again.status).toBe(200);
    expect(await counters(mine.client.id)).toEqual({ attended: 1, noShows: 0, lateCancels: 0 });
    const row = (await pg.query('SELECT "outcomeMarkedById" FROM "Appointment" WHERE id = $1', [mine.appt.id])).rows[0];
    expect(row.outcomeMarkedById).toBe(A.userId);
  });

  it("another barber's and another business's appointment is a 404 and nothing changes", async () => {
    const theirs = await appt(B.staffId, x, xScn, { noShows: 0 });
    const other = await appt(C.staffId, y, yScn, { noShows: 0 });
    for (const target of [theirs, other]) {
      const res = await mark(A.cookie, target.appt.id, { outcome: 'NO_SHOW' });
      expect(res.status).toBe(404);
      expect(await status(target.appt.id)).toBe('BOOKED');
      expect(await counters(target.client.id)).toEqual({ attended: 0, noShows: 0, lateCancels: 0 });
    }
  });

  it('keeps the rules: grace period, ended, late cancel is final', async () => {
    const early = await appt(A.staffId, x, xScn, { startAt: STARTED, minutes: 60, noShows: 0 });
    const grace = await mark(A.cookie, early.appt.id, { outcome: 'NO_SHOW' });
    expect(grace.status).toBe(409);
    expect(grace.body!.error.code).toBe('NO_SHOW_TOO_EARLY');
    expect(grace.body!.error.fields ?? grace.body!.error.data).toBeDefined();
    const notEnded = await mark(A.cookie, early.appt.id, { outcome: 'ATTENDED' });
    expect(notEnded.status).toBe(409);
    expect(notEnded.body!.error.code).toBe('NOT_ENDED');
    expect(await status(early.appt.id)).toBe('BOOKED');

    const future = await appt(A.staffId, x, xScn, { startAt: FUTURE });
    const notStarted = await mark(A.cookie, future.appt.id, { outcome: 'LATE_CANCEL' });
    expect(notStarted.status).toBe(409);
    expect(notStarted.body!.error.code).toBe('NOT_STARTED');

    const linkLate = await appt(A.staffId, x, xScn, {
      startAt: '2026-11-02T05:00:00.000Z',
      status: 'LATE_CANCEL',
      cancelledVia: 'LINK',
      noShows: 0,
    });
    for (const outcome of ['ATTENDED', 'NO_SHOW'] as const) {
      const res = await mark(A.cookie, linkLate.appt.id, { outcome });
      expect(res.status).toBe(409);
      expect(res.body!.error.code).toBe('CONFLICT');
    }
    expect(await status(linkLate.appt.id)).toBe('LATE_CANCEL');
  });

  it('two simultaneous marks count once', async () => {
    const mine = await appt(A.staffId, x, xScn, { noShows: 0 });
    const results = await Promise.all([
      mark(A.cookie, mine.appt.id, { outcome: 'NO_SHOW' }),
      mark(A.cookie, mine.appt.id, { outcome: 'NO_SHOW' }),
      mark(A.cookie, mine.appt.id, { outcome: 'NO_SHOW' }),
    ]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await counters(mine.client.id)).toEqual({ attended: 0, noShows: 1, lateCancels: 0 });
  });

  it('400 on a bad outcome, an unknown field or a bad id; 401 without a session', async () => {
    const mine = await appt(A.staffId, x, xScn);
    const bad = await mark(A.cookie, mine.appt.id, { outcome: 'EXCUSED' });
    expect(bad.status).toBe(400);
    expect(bad.body!.error.fields.outcome).toBeTruthy();
    expect((await mark(A.cookie, mine.appt.id, { outcome: 'ATTENDED', staffId: B.staffId })).status).toBe(400);
    expect((await mark(A.cookie, 'NOT-AN-ID', { outcome: 'ATTENDED' })).status).toBe(400);
    expect((await mark(undefined, mine.appt.id, { outcome: 'ATTENDED' })).status).toBe(401);
  });
});

describe('a barber cannot reach anything else', () => {
  it('every owner route stays 403 (booking, cancel, excuse, contact, clients, summary)', async () => {
    const mine = await appt(A.staffId, x, xScn, { status: 'NO_SHOW' });
    const id = mine.appt.id;
    const results = await Promise.all([
      call(cancelAppt, `/api/appointments/${id}/cancel`, { method: 'POST', cookie: A.cookie, params: { id }, body: {} }),
      call(excuseAppt, `/api/appointments/${id}/excuse`, { method: 'POST', cookie: A.cookie, params: { id }, body: {} }),
      call(patchContact, `/api/appointments/${id}/contact`, { method: 'PATCH', cookie: A.cookie, params: { id }, body: { contactName: 'X' } }),
      call(listClients, '/api/clients', { cookie: A.cookie }),
      call(getSummary, '/api/dashboard/summary', { cookie: A.cookie }),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403, 403, 403, 403]);
    expect(await status(id)).toBe('NO_SHOW');
  });

  it('a barber login that is not linked to a staff member has an empty, refused schedule', async () => {
    const D = await activatedPractitioner(x, '+96170000004', 'Barber D');
    const mine = await appt(D.staffId, x, xScn);
    await pg.query('UPDATE "StaffMember" SET "userId" = NULL WHERE id = $1', [D.staffId]);
    for (const res of [
      await today(D.cookie),
      await queue(D.cookie),
      await detail(D.cookie, mine.appt.id),
      await mark(D.cookie, mine.appt.id, { outcome: 'ATTENDED' }),
    ]) {
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain('Rana');
    }
    expect(await status(mine.appt.id)).toBe('BOOKED');
  });

  it('turning the login off or deactivating the person closes access at once', async () => {
    const E = await activatedPractitioner(x, '+96170000005', 'Barber E');
    const F = await activatedPractitioner(x, '+96170000006', 'Barber F');
    const mine = await appt(E.staffId, x, xScn);
    expect((await detail(E.cookie, mine.appt.id)).status).toBe(200);
    const off = await call(turnOff, `/api/staff/${E.staffId}/login`, {
      method: 'DELETE',
      cookie: x.cookie,
      params: { id: E.staffId },
    });
    expect(off.status).toBe(200);
    expect((await detail(E.cookie, mine.appt.id)).status).toBe(401);
    expect((await queue(E.cookie)).status).toBe(401);

    // F is deactivated (nothing active ahead of them): the login goes with the person.
    const fAppt = await appt(F.staffId, x, xScn, { status: 'ATTENDED', startAt: '2026-11-01T06:00:00.000Z' });
    expect((await detail(F.cookie, fAppt.appt.id)).status).toBe(200);
    const deact = await call(patchStaff, `/api/staff/${F.staffId}`, {
      method: 'PATCH',
      cookie: x.cookie,
      params: { id: F.staffId },
      body: { active: false },
    });
    expect(deact.status).toBe(200);
    expect((await today(F.cookie)).status).toBe(401);
  });
});
