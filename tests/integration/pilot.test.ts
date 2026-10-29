/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { GET as exportCsv } from '@/app/api/pilot/export.csv/route';
import { GET as getBaseline, PUT as putBaseline } from '@/app/api/pilot/baseline/route';
import { GET as getReport } from '@/app/api/pilot/report/route';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call } from './helpers/api';
import { newScenario, newTenant, type Tenant } from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';
import { newStaffCookie, seedAppointment, seedClient } from './helpers/outcomes';

let pg: Client;
let prisma: PrismaClient;
let a: Tenant;
let b: Tenant;
let aScn: Awaited<ReturnType<typeof newScenario>>;
let bScn: Awaited<ReturnType<typeof newScenario>>;
let staffCookie: string;

/** Wed 4 Nov 2026 12:00 Beirut (UTC+2). */
const NOW = new Date('2026-11-04T10:00:00Z');

const baseline = (cookie: string | undefined) =>
  call(getBaseline, '/api/pilot/baseline', { cookie });
const put = (cookie: string | undefined, body: unknown) =>
  call(putBaseline, '/api/pilot/baseline', { method: 'PUT', cookie, body });
const report = (cookie: string | undefined, query: Record<string, string> = {}) =>
  call(getReport, '/api/pilot/report', { cookie, query });
const csv = async (cookie: string | undefined, query: Record<string, string>) => {
  const url = new URL('http://localhost/api/pilot/export.csv');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await exportCsv(new Request(url, { headers: cookie ? { cookie } : {} }));
  const bytes = new Uint8Array(await res.clone().arrayBuffer());
  return { status: res.status, headers: res.headers, text: await res.text(), bytes };
};

const validBaseline = {
  fromDate: '2026-09-01',
  toDate: '2026-09-30',
  appointments: 100,
  noShows: 15,
  lateCancels: 3,
};

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
  await pg.query('DELETE FROM "PilotBaseline"');
  await pg.query('DELETE FROM "ReminderJob"');
  await pg.query('DELETE FROM "Appointment"');
  await pg.query('DELETE FROM "Client"');
  vi.setSystemTime(NOW);
});

describe('pilot baseline', () => {
  it('is null until set; PUT stores it, GET returns it, a second PUT replaces it', async () => {
    expect((await baseline(a.cookie)).body).toEqual({ baseline: null });
    const saved = await put(a.cookie, validBaseline);
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ baseline: validBaseline });
    expect((await baseline(a.cookie)).body).toEqual({ baseline: validBaseline });
    const next = { ...validBaseline, appointments: 120, noShows: 12 };
    expect((await put(a.cookie, next)).body).toEqual({ baseline: next });
    expect((await pg.query('SELECT count(*)::int AS n FROM "PilotBaseline"')).rows[0].n).toBe(1);
  });

  it('one business’s baseline is invisible to the other', async () => {
    await put(a.cookie, validBaseline);
    expect((await baseline(b.cookie)).body).toEqual({ baseline: null });
    await put(b.cookie, { ...validBaseline, appointments: 50, noShows: 5 });
    expect((await baseline(a.cookie)).body!.baseline.appointments).toBe(100);
  });

  it('accepts a period of exactly 31 days ending today', async () => {
    const res = await put(a.cookie, {
      ...validBaseline,
      fromDate: '2026-10-05',
      toDate: '2026-11-04',
    });
    expect(res.status).toBe(200);
  });

  it.each([
    ['end before start', { fromDate: '2026-09-30', toDate: '2026-09-01' }, 'toDate'],
    ['32 days', { fromDate: '2026-10-04', toDate: '2026-11-04' }, 'toDate'],
    ['ends in the future', { fromDate: '2026-10-20', toDate: '2026-11-05' }, 'toDate'],
    ['impossible date', { fromDate: '2026-02-31' }, 'fromDate'],
    ['noShows above appointments', { appointments: 10, noShows: 11 }, 'noShows'],
    ['negative count', { lateCancels: -1 }, 'lateCancels'],
    ['fractional count', { appointments: 10.5 }, 'appointments'],
    ['text date', { fromDate: 'yesterday' }, 'fromDate'],
  ])('400 with fields for %s', async (_name, over, field) => {
    const res = await put(a.cookie, { ...validBaseline, ...over });
    expect(res.status).toBe(400);
    expect(res.body!.error.code).toBe('VALIDATION_FAILED');
    expect(res.body!.error.fields).toHaveProperty(field);
    expect((await baseline(a.cookie)).body).toEqual({ baseline: null });
  });

  it('400 for unknown fields (including businessId) and a missing field', async () => {
    expect((await put(a.cookie, { ...validBaseline, businessId: b.businessId })).status).toBe(400);
    expect((await put(a.cookie, { ...validBaseline, note: 'x' })).status).toBe(400);
    const { lateCancels: _l, ...missing } = validBaseline;
    expect((await put(a.cookie, missing)).status).toBe(400);
  });

  it('STAFF -> 403 for GET and PUT, no session -> 401', async () => {
    expect((await baseline(staffCookie)).status).toBe(403);
    expect((await put(staffCookie, validBaseline)).status).toBe(403);
    expect((await baseline(undefined)).status).toBe(401);
    expect((await put(undefined, validBaseline)).status).toBe(401);
    expect((await pg.query('SELECT 1 FROM "PilotBaseline"')).rowCount).toBe(0);
  });
});

describe('GET /api/pilot/report', () => {
  let slot = 0;
  async function add(
    startAt: string,
    status: any,
    o: {
      source?: any;
      cancelledVia?: any;
      confirmed?: boolean;
      tenant?: Tenant;
      scn?: typeof aScn;
    } = {},
  ) {
    const tenant = o.tenant ?? a;
    const scn = o.scn ?? aScn;
    const client = await seedClient(prisma, tenant.businessId, {
      name: `C${slot}`,
      phone: `+9617${String(2000000 + slot++)}`,
    });
    return seedAppointment(prisma, {
      businessId: tenant.businessId,
      clientId: client.id,
      staffId: scn.staffIds[0]!,
      serviceId: scn.serviceId,
      startAt,
      status,
      source: o.source ?? 'PUBLIC',
      cancelledVia: o.cancelledVia ?? null,
      confirmedAt: o.confirmed ? new Date(startAt) : null,
    });
  }
  const sent = (appointmentId: string, kind: any, channel: any) =>
    prisma.reminderJob.create({
      data: {
        businessId: a.businessId,
        appointmentId,
        kind,
        channel,
        dueAt: new Date('2026-10-01T00:00:00Z'),
        status: 'SENT',
        sentAt: new Date('2026-10-01T00:00:00Z'),
      },
    });

  async function seedPilot() {
    // Week of Mon 19 Oct (the DST week: clocks go back on Sun 25 Oct).
    const a1 = await add('2026-10-20T06:00:00Z', 'ATTENDED', { confirmed: true });
    await add('2026-10-20T08:00:00Z', 'ATTENDED');
    await add('2026-10-21T06:00:00Z', 'NO_SHOW');
    await add('2026-10-22T06:00:00Z', 'LATE_CANCEL', { cancelledVia: 'LINK' });
    await add('2026-10-22T09:00:00Z', 'CANCELLED', { cancelledVia: 'LINK' });
    await add('2026-10-25T21:30:00Z', 'ATTENDED'); // Sun 23:30 local: still the DST week
    // Week of Mon 26 Oct.
    await add('2026-10-25T22:30:00Z', 'NO_SHOW'); // Mon 00:30 local: already the next week
    const a2 = await add('2026-10-28T06:00:00Z', 'ATTENDED', { confirmed: true });
    await add('2026-10-28T08:00:00Z', 'ATTENDED');
    await add('2026-10-28T10:00:00Z', 'ATTENDED');
    await add('2026-10-29T06:00:00Z', 'ATTENDED', { source: 'WAITLIST' });
    await add('2026-10-29T08:00:00Z', 'CANCELLED', { cancelledVia: 'STAFF' });
    // Week of Mon 2 Nov (current).
    const a3 = await add('2026-11-02T06:00:00Z', 'ATTENDED', { confirmed: true });
    await add('2026-11-02T08:00:00Z', 'ATTENDED');
    await add('2026-11-03T06:00:00Z', 'NO_SHOW');
    const a4 = await add('2026-11-03T08:00:00Z', 'NO_SHOW');
    await add('2026-11-04T06:00:00Z', 'BOOKED'); // started, not yet marked: counts as an appointment only
    await add('2026-11-04T12:00:00Z', 'BOOKED'); // still to come: not part of the pilot yet
    const a5 = await add('2026-11-03T10:00:00Z', 'CONFIRMED', { confirmed: true });
    void a5;
    // 4 appointments had a reminder (3 confirmed); a1 had two (email + WhatsApp) but counts once; BOOKING kind ignored.
    await sent(a1.id, 'H24', 'EMAIL');
    await sent(a1.id, 'H2', 'WHATSAPP');
    await sent(a2.id, 'H24', 'EMAIL');
    await sent(a3.id, 'H2', 'EMAIL');
    await sent(a4.id, 'H24', 'EMAIL');
    await sent(a5.id, 'BOOKING', 'EMAIL');
    // The other business must not leak into any number.
    const bo = await add('2026-10-30T06:00:00Z', 'NO_SHOW', { tenant: b, scn: bScn });
    void bo;
  }

  it('computes exact weekly and pilot numbers, baseline comparison and signals', async () => {
    await seedPilot();
    await put(a.cookie, validBaseline); // 15 / 100 = 15.0 %
    const res = await report(a.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      baseline: validBaseline,
      pilot: {
        fromDate: '2026-10-20',
        toDate: '2026-11-04',
        daysCovered: 16,
        appointments: 16,
        attended: 9,
        noShows: 4,
        lateCancels: 1,
        noShowRate: 30.8, // 4 / (9 + 4)
        baselineRate: 15,
        changePoints: 15.8, // 30.769 - 15
        changeRelativePct: 105.1, // 15.769 / 15
      },
      weekly: [
        {
          weekStart: '2026-10-12',
          appointments: 0,
          attended: 0,
          noShows: 0,
          lateCancels: 0,
          noShowRate: null,
        },
        {
          weekStart: '2026-10-19',
          appointments: 5,
          attended: 3,
          noShows: 1,
          lateCancels: 1,
          noShowRate: 25,
        },
        {
          weekStart: '2026-10-26',
          appointments: 5,
          attended: 4,
          noShows: 1,
          lateCancels: 0,
          noShowRate: 20,
        },
        {
          weekStart: '2026-11-02',
          appointments: 6,
          attended: 2,
          noShows: 2,
          lateCancels: 0,
          noShowRate: 50,
        },
      ],
      signals: {
        confirmRate: 75, // 3 of the 4 reminded appointments were confirmed
        cancellationsViaLink: 2,
        waitlistRefills: 1,
        waitlistRefillRate: 33.3, // 1 refill / 3 cancellations
      },
    });
  });

  it('weeks controls the weekly series length (1 to 26)', async () => {
    await seedPilot();
    expect(
      (await report(a.cookie, { weeks: '1' })).body!.weekly.map((w: any) => w.weekStart),
    ).toEqual(['2026-11-02']);
    expect((await report(a.cookie, { weeks: '26' })).body!.weekly).toHaveLength(26);
    for (const weeks of ['0', '27', 'x', '1.5'])
      expect((await report(a.cookie, { weeks })).status).toBe(400);
    expect((await report(a.cookie, { bogus: '1' })).status).toBe(400);
  });

  it('without data or a baseline everything is zero or null, never NaN', async () => {
    const res = await report(a.cookie);
    expect(res.status).toBe(200);
    expect(res.body!.baseline).toBeNull();
    expect(res.body!.pilot).toMatchObject({
      appointments: 0,
      attended: 0,
      noShows: 0,
      lateCancels: 0,
      noShowRate: null,
      baselineRate: null,
      changePoints: null,
      changeRelativePct: null,
    });
    expect(res.body!.signals).toEqual({
      confirmRate: null,
      cancellationsViaLink: 0,
      waitlistRefills: 0,
      waitlistRefillRate: null,
    });
    expect(res.body!.weekly.every((w: any) => w.noShowRate === null)).toBe(true);
  });

  it('a baseline rate of 0 gives points but no relative change', async () => {
    await seedPilot();
    await put(a.cookie, { ...validBaseline, noShows: 0 });
    const { pilot } = (await report(a.cookie)).body!;
    expect(pilot.baselineRate).toBe(0);
    expect(pilot.changePoints).toBe(30.8);
    expect(pilot.changeRelativePct).toBeNull();
  });

  it('is owner only and scoped: STAFF 403, no session 401, B sees only B', async () => {
    await seedPilot();
    expect((await report(staffCookie)).status).toBe(403);
    expect((await report(undefined)).status).toBe(401);
    const other = await report(b.cookie);
    expect(other.body!.pilot).toMatchObject({
      appointments: 1,
      noShows: 1,
      attended: 0,
      noShowRate: 100,
    });
  });
});

describe('GET /api/pilot/export.csv', () => {
  let n = 0;
  async function add(
    tenant: Tenant,
    scn: typeof aScn,
    startAt: string,
    name: string,
    over: Record<string, unknown> = {},
  ) {
    const client = await seedClient(prisma, tenant.businessId, {
      name,
      phone: `+9617${String(3000000 + n++)}`,
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
  const lines = (text: string) => text.replace(/^﻿/, '').split('\r\n');

  it('is a UTF-8 attachment with a BOM and the agreed columns', async () => {
    await add(a, aScn, '2026-11-03T06:00:00Z', 'Plain');
    const res = await csv(a.cookie, { from: '2026-11-01', to: '2026-11-30' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="[\w.-]+\.csv"$/);
    expect([...res.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(lines(res.text)[0]).toBe(
      'date,start,end,service,staff,client name,client phone,status,source,confirmedAt,outcomeMarkedAt',
    );
    expect(lines(res.text)).toHaveLength(3); // header, one row, trailing empty after the final CRLF
  });

  it('renders local date and times, the DST-night boundary, status, source and timestamps', async () => {
    const confirmed = new Date('2026-10-24T10:00:00Z');
    const marked = new Date('2026-10-26T08:00:00Z');
    const appt = await add(a, aScn, '2026-10-25T21:30:00Z', 'Night', {
      status: 'ATTENDED',
      source: 'FRONT_DESK',
      confirmedAt: confirmed,
    });
    await prisma.appointment.update({ where: { id: appt.id }, data: { outcomeMarkedAt: marked } });
    const res = await csv(a.cookie, { from: '2026-10-25', to: '2026-10-25' });
    const row = lines(res.text)[1]!;
    const service = (await prisma.service.findUniqueOrThrow({ where: { id: aScn.serviceId } }))
      .name;
    const staff = (await prisma.staffMember.findUniqueOrThrow({ where: { id: aScn.staffIds[0]! } }))
      .displayName;
    // 23:30 local on the 25th; it ends at 00:00 local on the 26th (clocks went back at midnight).
    expect(row).toBe(
      `2026-10-25,23:30,00:00,${service},${staff},Night,'+9617${3000000 + n - 1},ATTENDED,FRONT_DESK,${confirmed.toISOString()},${marked.toISOString()}`,
    );
  });

  it('neutralises formulas, quotes commas, quotes and newlines, and keeps Arabic text', async () => {
    await add(a, aScn, '2026-11-03T06:00:00Z', '=HYPERLINK("http://evil","x")');
    await add(a, aScn, '2026-11-03T07:00:00Z', '@SUM(1+1)');
    await add(a, aScn, '2026-11-03T08:00:00Z', 'Smith, "Bob"\nJr');
    await add(a, aScn, '2026-11-03T09:00:00Z', 'سارة الحداد');
    await add(a, aScn, '2026-11-03T10:00:00Z', '-2+3');
    const res = await csv(a.cookie, { from: '2026-11-03', to: '2026-11-03' });
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(res.text).toContain(`'@SUM(1+1)`);
    expect(res.text).toContain(`"Smith, ""Bob""\nJr"`);
    expect(res.text).toContain('سارة الحداد');
    expect(res.text).toContain(`'-2+3`);
    // No cell starts with a bare formula character.
    for (const cell of res.text.split(/,|\r\n/)) expect(/^[=@]/.test(cell)).toBe(false);
  });

  it('covers only the requested local days of the session business', async () => {
    await add(a, aScn, '2026-11-02T21:59:00Z', 'Before', { minutes: 1 }); // 23:59 local on 2 Nov
    await add(a, aScn, '2026-11-02T22:00:00Z', 'Inside1'); // 00:00 local on 3 Nov
    await add(a, aScn, '2026-11-03T21:30:00Z', 'Inside2'); // 23:30 local on 3 Nov
    await add(a, aScn, '2026-11-03T22:00:00Z', 'After'); // 00:00 local on 4 Nov
    await add(b, bScn, '2026-11-03T06:00:00Z', 'OtherTenant');
    const res = await csv(a.cookie, { from: '2026-11-03', to: '2026-11-03' });
    expect(res.text).toContain('Inside1');
    expect(res.text).toContain('Inside2');
    for (const x of ['Before', 'After', 'OtherTenant']) expect(res.text).not.toContain(x);
  });

  it('accepts 366 days and rejects 367, reversed and malformed ranges (400)', async () => {
    expect((await csv(a.cookie, { from: '2026-01-01', to: '2026-12-31' })).status).toBe(200); // 365 days
    expect((await csv(a.cookie, { from: '2026-01-01', to: '2027-01-01' })).status).toBe(200); // 366 days
    expect((await csv(a.cookie, { from: '2026-01-01', to: '2027-01-02' })).status).toBe(400); // 367 days
    expect((await csv(a.cookie, { from: '2026-11-05', to: '2026-11-01' })).status).toBe(400);
    expect((await csv(a.cookie, { from: 'x', to: '2026-11-01' })).status).toBe(400);
    expect((await csv(a.cookie, { from: '2026-11-01' })).status).toBe(400);
    expect(
      (await csv(a.cookie, { from: '2026-11-01', to: '2026-11-02', businessId: b.businessId }))
        .status,
    ).toBe(400);
  });

  it('is owner only: STAFF 403, no session 401', async () => {
    expect((await csv(staffCookie, { from: '2026-11-01', to: '2026-11-02' })).status).toBe(403);
    expect((await csv(undefined, { from: '2026-11-01', to: '2026-11-02' })).status).toBe(401);
  });
});
