/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { GET as outcomesQueue } from '@/app/api/outcomes/queue/route';
import { GET as whatsappDue } from '@/app/api/reminders/whatsapp-due/route';
import { GET as summary } from '@/app/api/dashboard/summary/route';
import { GET as today } from '@/app/api/dashboard/today/route';
import { GET as waitlistActivity } from '@/app/api/waitlist/activity/route';
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
import { seedEntry } from './helpers/waitlist';

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
  await pg.query('DELETE FROM "WaitlistOffer"');
  await pg.query('DELETE FROM "WaitlistEntry"');
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

  it('whatsappDue is the same count as the due list at every point in time', async () => {
    await bookPublicly(a.slug, bookingBody(aScn.serviceId, aScn.staffIds[0]!, at('07:00')));
    await bookPublicly(a.slug, bookingBody(aScn.serviceId, aScn.staffIds[0]!, at('09:00')));
    const seen = new Set<number>();
    for (const iso of [
      '2026-11-02T08:00:00Z',
      '2026-11-03T08:00:00Z',
      '2026-11-03T10:00:00Z',
      '2026-11-04T05:30:00Z',
      '2026-11-04T07:30:00Z',
      '2026-11-04T12:00:00Z',
    ]) {
      vi.setSystemTime(new Date(iso));
      const list = await call(whatsappDue, '/api/reminders/whatsapp-due', { cookie: a.cookie });
      const res = await sum(a.cookie);
      expect(res.body!.whatsappDue, iso).toBe(list.body!.count);
      seen.add(list.body!.count);
    }
    expect(seen.size).toBeGreaterThan(1); // the count really changes as the windows open and close
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
    await add('2026-11-04T14:00:00Z', { status: 'PENDING_PAYMENT' }); // listed, never counted
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
    expect(body.appointments).toHaveLength(9); // 6 live + CANCELLED + LATE_CANCEL + PENDING_PAYMENT (flagged by status)
    const starts = body.appointments.map((x: any) => x.startAt);
    expect(starts).toEqual([...starts].sort());
    expect(body.stats).toEqual({
      appointments: 6,
      confirmed: 1,
      noReply: 5,
      refilledFromWaitlist: 0, // F45: counted on the day the claim happened (T = 3 Nov, 1 Nov), not the appointment day
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

  it('noReply only counts BOOKED appointments that have not started; refills follow the claim day', async () => {
    vi.setSystemTime(new Date('2026-11-03T09:30:00Z'));
    await add('2026-11-03T08:00:00Z', {}, a, aScn, { name: 'Started, unmarked' }); // an outcome to mark
    await add('2026-11-03T12:00:00Z', {}, a, aScn, { name: 'Still to come' });
    await add('2026-11-03T13:00:00Z', {
      source: 'WAITLIST',
      createdAt: new Date('2026-10-20T00:00:00Z'),
    });
    await add('2026-11-04T13:00:00Z', {
      source: 'WAITLIST',
      createdAt: new Date('2026-11-03T09:00:00Z'),
    });
    const res = await day(a.cookie, { date: '2026-11-03' });
    expect(res.body!.stats).toEqual({
      appointments: 3,
      confirmed: 0,
      noReply: 2,
      refilledFromWaitlist: 1,
    });
    // F45: the 4 Nov appointment was claimed on 3 Nov, so 4 Nov itself shows no refill.
    expect((await day(a.cookie, { date: '2026-11-04' })).body!.stats.refilledFromWaitlist).toBe(0);
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

// F45: the "Refilled from waitlist" tile counts replacement bookings whose claim happened on the viewed local
// day (business timezone), whatever day the appointment is on. The claim time is the replacement booking's
// createdAt, the same instant the waitlist activity card shows for a claimed slot.
describe('Refilled from waitlist tile (F45)', () => {
  const refilled = async (date: string) =>
    (await day(a.cookie, { date })).body!.stats.refilledFromWaitlist as number;
  const refill = (startAt: string, createdAt: string, over: Record<string, unknown> = {}) =>
    add(startAt, { source: 'WAITLIST', createdAt: new Date(createdAt), ...over });

  it('a refill claimed on D for an appointment on D+3 counts on D and not on D+3', async () => {
    await refill('2026-11-06T09:00:00Z', '2026-11-03T08:00:00Z');
    expect(await refilled('2026-11-03')).toBe(1);
    expect(await refilled('2026-11-06')).toBe(0);
    expect(await refilled('2026-11-04')).toBe(0);
    // The appointment itself is still listed on its own day, only the tile follows the claim.
    expect((await day(a.cookie, { date: '2026-11-06' })).body!.appointments).toHaveLength(1);
  });

  it('two refills claimed the same day count twice, whichever days they are for', async () => {
    await refill('2026-11-05T09:00:00Z', '2026-11-03T06:00:00Z');
    await refill('2026-11-09T09:00:00Z', '2026-11-03T15:00:00Z');
    await refill('2026-11-03T16:00:00Z', '2026-11-03T10:00:00Z'); // same day claim and visit
    expect(await refilled('2026-11-03')).toBe(3);
  });

  it('a cancelled replacement (staff, link or late) is not counted', async () => {
    await refill('2026-11-05T09:00:00Z', '2026-11-03T06:00:00Z');
    await refill('2026-11-05T10:00:00Z', '2026-11-03T06:30:00Z', { status: 'CANCELLED', cancelledVia: 'STAFF' });
    await refill('2026-11-05T11:00:00Z', '2026-11-03T07:00:00Z', { status: 'CANCELLED', cancelledVia: 'LINK' });
    await refill('2026-11-05T12:00:00Z', '2026-11-03T07:30:00Z', { status: 'LATE_CANCEL', cancelledVia: 'LINK' });
    expect(await refilled('2026-11-03')).toBe(1);
  });

  it('a deposit hold (PENDING_PAYMENT) is not a refill until it is paid', async () => {
    const hold = await refill('2026-11-05T09:00:00Z', '2026-11-03T06:00:00Z', { status: 'PENDING_PAYMENT' });
    expect(await refilled('2026-11-03')).toBe(0);
    await prisma.appointment.update({ where: { id: hold.id }, data: { status: 'BOOKED' } });
    expect(await refilled('2026-11-03')).toBe(1);
  });

  it('attended and no-show refills still count; other sources never do', async () => {
    await refill('2026-11-02T09:00:00Z', '2026-11-03T06:00:00Z', { status: 'ATTENDED' });
    await refill('2026-11-02T10:00:00Z', '2026-11-03T06:10:00Z', { status: 'NO_SHOW' });
    await add('2026-11-05T09:00:00Z', { source: 'PUBLIC', createdAt: new Date('2026-11-03T06:00:00Z') });
    await add('2026-11-05T10:00:00Z', { source: 'FRONT_DESK', createdAt: new Date('2026-11-03T06:00:00Z') });
    expect(await refilled('2026-11-03')).toBe(2);
  });

  it('the day boundary is local midnight in Asia/Beirut (UTC+2 in November), not UTC', async () => {
    await refill('2026-11-08T09:00:00Z', '2026-11-03T21:59:59Z'); // 23:59:59 on 3 Nov, Beirut
    await refill('2026-11-08T10:00:00Z', '2026-11-03T22:00:00Z'); // 00:00:00 on 4 Nov, Beirut
    await refill('2026-11-08T11:00:00Z', '2026-11-04T21:59:59Z'); // 23:59:59 on 4 Nov
    await refill('2026-11-08T12:00:00Z', '2026-11-04T22:00:00Z'); // 00:00:00 on 5 Nov
    expect(await refilled('2026-11-03')).toBe(1);
    expect(await refilled('2026-11-04')).toBe(2);
    expect(await refilled('2026-11-05')).toBe(1);
  });

  it('is scoped to the business', async () => {
    await add('2026-11-05T09:00:00Z', { source: 'WAITLIST', createdAt: new Date('2026-11-03T06:00:00Z') }, b, bScn);
    expect(await refilled('2026-11-03')).toBe(0);
    expect((await day(b.cookie, { date: '2026-11-03' })).body!.stats.refilledFromWaitlist).toBe(1);
  });

  it('the activity card and the tile agree: each claimed slot is one refill on its claim day', async () => {
    const claimedAt = '2026-11-03T08:00:00Z';
    const entry = await seedEntry(prisma, a.businessId, aScn.serviceId, { createdAt: new Date(NOW.getTime() - 3_600_000) });
    const claimedAppt = await refill('2026-11-06T09:00:00Z', claimedAt);
    const freed = await add('2026-11-06T09:00:00Z', { status: 'CANCELLED', cancelledVia: 'STAFF' }, a, aScn);
    await prisma.waitlistOffer.create({
      data: {
        businessId: a.businessId,
        entryId: entry.entryId,
        staffId: aScn.staffIds[0]!,
        startAt: new Date('2026-11-06T09:00:00Z'),
        endAt: new Date('2026-11-06T09:30:00Z'),
        expiresAt: new Date('2026-11-03T08:30:00Z'),
        status: 'CLAIMED',
        claimedAppointmentId: claimedAppt.id,
        freedFromAppointmentId: freed.id,
      },
    });
    vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
    const activity = await call(waitlistActivity, '/api/waitlist/activity', {
      cookie: a.cookie,
      query: { limit: '10' },
    });
    const claimedItems = activity.body!.items.filter((i: any) => i.type === 'CLAIMED');
    expect(claimedItems).toHaveLength(1);
    expect(claimedItems[0].at).toBe(new Date(claimedAt).toISOString());
    expect(await refilled('2026-11-03')).toBe(claimedItems.length);
    expect(await refilled('2026-11-06')).toBe(0);
  });
});
