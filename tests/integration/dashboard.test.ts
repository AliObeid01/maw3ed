/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { GET as outcomesQueue } from '@/app/api/outcomes/queue/route';
import { GET as whatsappDue } from '@/app/api/reminders/whatsapp-due/route';
import { GET as summary } from '@/app/api/dashboard/summary/route';
import { GET as today } from '@/app/api/dashboard/today/route';
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

/** Tue 3 Nov 2026 10:00 Beirut: the 24 h WhatsApp reminder for a 4 Nov 07:00Z booking is due. */
const T = new Date('2026-11-03T08:00:00Z');

const sum = (cookie: string | undefined) => call(summary, '/api/dashboard/summary', { cookie });
const day = (cookie: string | undefined, query: Record<string, string> = {}) =>
  call(today, '/api/dashboard/today', { cookie, query });

let n = 0;
async function add(
  startAt: string,
  over: Record<string, unknown> = {},
  tenant: Tenant = a,
  scn: typeof aScn = aScn,
  clientOver: Record<string, unknown> = {},
) {
  const client = await seedClient(prisma, tenant.businessId, {
    name: `Person ${n}`,
    phone: `+9617${String(4000000 + n++)}`,
    ...clientOver,
  });
  return seedAppointment(prisma, {
    businessId: tenant.businessId,
    clientId: client.id,
    staffId: scn.staffIds[0]!,
    serviceId: scn.serviceId,
    startAt,
    ...over,
  } as any);
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
});

describe('GET /api/dashboard/summary', () => {
  it('returns the same counts as the WhatsApp due list and the outcome queue', async () => {
    const booked = await bookPublicly(
      a.slug,
      bookingBody(aScn.serviceId, aScn.staffIds[0]!, at('07:00')),
    );
    expect(booked.status).toBe(201);
    await add('2026-10-30T06:00:00Z');
    await add('2026-10-30T08:00:00Z', { status: 'CONFIRMED' });
    await add('2026-10-30T10:00:00Z', { status: 'ATTENDED' });

    vi.setSystemTime(T);
    const wa = await call(whatsappDue, '/api/reminders/whatsapp-due', { cookie: a.cookie });
    const q = await call(outcomesQueue, '/api/outcomes/queue', { cookie: a.cookie });
    expect(wa.body!.count).toBeGreaterThan(0);
    expect(q.body!.count).toBe(2);

    for (const cookie of [a.cookie, staffCookie]) {
      const res = await sum(cookie);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ whatsappDue: wa.body!.count, outcomesToMark: 2 });
    }
  });

  it('is scoped per business, 401 without a session, 400 for unexpected params is not applicable', async () => {
    await add('2026-10-30T06:00:00Z');
    expect((await sum(b.cookie)).body).toEqual({ whatsappDue: 0, outcomesToMark: 0 });
    expect((await sum(undefined)).status).toBe(401);
  });
});

describe('GET /api/dashboard/today', () => {
  async function seedDay() {
    const publicBooking = await bookPublicly(
      a.slug,
      bookingBody(aScn.serviceId, aScn.staffIds[0]!, at('07:00'), { name: 'Public Pat' }),
    );
    vi.setSystemTime(T);
    const pub = publicBooking.body!.appointment.id as string;
    await add('2026-11-03T21:30:00Z', {}, a, aScn, { name: 'DayBefore' });
    await add('2026-11-03T22:00:00Z', {}, a, aScn, { name: 'Midnight' });
    const conf = await add('2026-11-04T09:00:00Z', {
      status: 'CONFIRMED',
      confirmedAt: new Date('2026-11-03T06:00:00Z'),
    });
    await add('2026-11-04T10:00:00Z', { status: 'CANCELLED', cancelledVia: 'LINK' });
    await add('2026-11-04T11:00:00Z', { status: 'LATE_CANCEL', cancelledVia: 'LINK' });
    const refill = await add(
      '2026-11-04T12:00:00Z',
      { source: 'WAITLIST', createdAt: T },
      a,
      aScn,
      { name: 'Refill', noShows: 2 },
    );
    await add('2026-11-04T13:00:00Z', {
      source: 'WAITLIST',
      createdAt: new Date('2026-11-01T08:00:00Z'),
    });
    await add('2026-11-04T21:30:00Z', {}, a, aScn, { name: 'LateNight' });
    await add('2026-11-04T22:00:00Z', {}, a, aScn, { name: 'DayAfter' });
    await add('2026-11-04T09:00:00Z', {}, b, bScn, { name: 'OtherTenantPerson' });
    return { pub, conf: conf.id, refill: refill.id };
  }

  it('lists the local day with stats, staff columns and flags', async () => {
    const ids = await seedDay();
    // Unconfirmed pending WhatsApp reminder only exists for the publicly booked appointment.
    const res = await day(a.cookie, { date: '2026-11-04' });
    expect(res.status).toBe(200);
    const body = res.body!;
    expect(body.date).toBe('2026-11-04');
    expect(body.timezone).toBe('Asia/Beirut');
    const listed = body.appointments.map((x: any) => x.client.name);
    expect(listed).toEqual(
      expect.arrayContaining(['Midnight', 'Public Pat', 'Refill', 'LateNight']),
    );
    expect(listed).not.toContain('DayBefore');
    expect(listed).not.toContain('DayAfter');
    expect(listed).not.toContain('OtherTenantPerson');
    expect(body.appointments).toHaveLength(8); // 6 live + CANCELLED + LATE_CANCEL (flagged by status)
    const starts = body.appointments.map((x: any) => x.startAt);
    expect(starts).toEqual([...starts].sort());
    expect(body.stats).toEqual({
      appointments: 6,
      confirmed: 1,
      noReply: 5,
      refilledFromWaitlist: 1,
    });
    expect(body.staff.map((s: any) => s.id)).toContain(aScn.staffIds[0]); // plus the bookable owner

    const by = Object.fromEntries(body.appointments.map((x: any) => [x.id, x]));
    expect(by[ids.conf]).toMatchObject({
      status: 'CONFIRMED',
      confirmedAt: '2026-11-03T06:00:00.000Z',
    });
    expect(by[ids.refill]).toMatchObject({
      source: 'WAITLIST',
      client: { name: 'Refill', noShows: 2, repeatNoShow: true },
    });
    expect(by[ids.pub]).toMatchObject({
      status: 'BOOKED',
      source: 'PUBLIC',
      confirmedAt: null,
      service: { id: aScn.serviceId, name: expect.any(String), durationMin: 30 },
      staff: { id: aScn.staffIds[0] },
      reminders: { whatsappPending: true },
    });
    expect(
      body.appointments.filter((x: any) => x.reminders.whatsappPending).map((x: any) => x.id),
    ).toEqual([ids.pub]);
    const wa = await call(whatsappDue, '/api/reminders/whatsapp-due', { cookie: a.cookie });
    expect(body.whatsappDue).toBe(wa.body!.count);
    const statuses = body.appointments.map((x: any) => x.status);
    expect(statuses).toEqual(expect.arrayContaining(['CANCELLED', 'LATE_CANCEL']));
  });

  it('defaults to today in the business timezone and counts outcomes still to mark', async () => {
    vi.setSystemTime(new Date('2026-11-03T21:30:00Z')); // 23:30 local on 3 Nov (still the 3rd in Beirut)
    await add('2026-11-03T08:00:00Z', {}, a, aScn, { name: 'Earlier today' }); // ended: needs an outcome
    await add('2026-11-04T08:00:00Z');
    const res = await day(staffCookie);
    expect(res.status).toBe(200);
    expect(res.body!.date).toBe('2026-11-03');
    expect(res.body!.appointments.map((x: any) => x.client.name)).toEqual(['Earlier today']);
    expect(res.body!.outcomesToMark).toBe(1);
    vi.setSystemTime(new Date('2026-11-03T22:00:00Z')); // midnight local: now it is the 4th
    expect((await day(a.cookie)).body!.date).toBe('2026-11-04');
  });

  it('day boundaries are local midnight, also on the 25-hour DST day', async () => {
    // Lebanon sets the clocks back at midnight ending Sat 24 Oct: the 24th has 25 hours, 21:00Z to 22:00Z.
    await add('2026-10-23T20:59:00Z', { minutes: 1 }, a, aScn, { name: 'PrevDay' }); // 23:59 on the 23rd (UTC+3)
    await add('2026-10-23T21:00:00Z', {}, a, aScn, { name: 'First' }); // 00:00 on the 24th (UTC+3)
    await add('2026-10-24T21:10:00Z', {}, a, aScn, { name: 'Repeated hour' }); // 23:10 the second time (UTC+2)
    await add('2026-10-24T21:59:00Z', { minutes: 1 }, a, aScn, { name: 'Last' }); // 23:59 on the 24th (UTC+2)
    await add('2026-10-24T22:00:00Z', {}, a, aScn, { name: 'NextDay' }); // 00:00 on the 25th
    const res = await day(a.cookie, { date: '2026-10-24' });
    expect(res.body!.appointments.map((x: any) => x.client.name)).toEqual([
      'First',
      'Repeated hour',
      'Last',
    ]);
  });

  it('lists only active, bookable staff of this business', async () => {
    const inactive = await prisma.staffMember.create({
      data: { businessId: a.businessId, displayName: 'Gone', active: false },
    });
    const desk = await prisma.staffMember.create({
      data: { businessId: a.businessId, displayName: 'Front desk', bookable: false },
    });
    const res = await day(a.cookie, { date: '2026-11-04' });
    const ids = res.body!.staff.map((s: any) => s.id);
    expect(ids).toContain(aScn.staffIds[0]);
    expect(ids).not.toContain(inactive.id);
    expect(ids).not.toContain(desk.id);
    expect(JSON.stringify(res.body)).not.toContain(bScn.staffIds[0]);
  });

  it('400 for a malformed or impossible date, a range or unknown params; 401 without a session', async () => {
    const bad: Record<string, string>[] = [
      { date: '2026-02-31' },
      { date: 'tomorrow' },
      { date: '2026-11-04T00:00:00Z' },
      { date: '2026-11-04', to: '2026-11-05' },
      { businessId: b.businessId },
    ];
    for (const q of bad) {
      const res = await day(a.cookie, q);
      expect(res.status).toBe(400);
      expect(res.body!.error.code).toBe('VALIDATION_FAILED');
    }
    expect((await day(a.cookie, { date: '2026-02-31' })).body!.error.fields).toHaveProperty('date');
    expect((await day(undefined)).status).toBe(401);
  });

  it('never shows another business’s appointments', async () => {
    await add('2026-11-04T09:00:00Z', {}, b, bScn, { name: 'OtherTenantPerson' });
    const res = await day(a.cookie, { date: '2026-11-04' });
    expect(res.body!.appointments).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain('OtherTenantPerson');
  });
});
