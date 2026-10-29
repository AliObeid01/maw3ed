/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { GET as getAppointment } from '@/app/api/appointments/[id]/route';
import { POST as cancelAppointment } from '@/app/api/appointments/[id]/cancel/route';
import { GET as listAppointments } from '@/app/api/appointments/route';
import { POST as createInvite } from '@/app/api/invites/route';
import { POST as acceptInvite } from '@/app/api/invites/[token]/accept/route';
import { resetServerEnv } from '@/server/env';
import { AppError } from '@/server/http/errors';
import { rootLogger } from '@/server/http/logger';
import { defaultBookDeps } from '@/server/services/booking';
import { publicBookingService } from '@/server/services/publicBooking';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call, PASSWORD, unique } from './helpers/api';
import {
  at,
  bookAtFrontDesk,
  bookingBody,
  bookPublicly,
  DAY,
  getSlots,
  newKey,
  newPhone,
  newScenario,
  newTenant,
  NOW,
  startsOf,
  type Tenant,
} from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';

let pg: Client;
let prisma: PrismaClient;
let t: Tenant;

beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
  await truncateAll(pg);
  prisma = newPrisma();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  t = await newTenant();
});
afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await pg.end();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnv();
});

const count = async (table: string) =>
  Number((await pg.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n);

let conflictSeq = 0;
const ctx = () => ({ requestId: 'test-request-0001', logger: rootLogger });

/** Insert a conflicting active appointment directly, as another request that won the race would. */
async function insertConflict(serviceId: string, staffId: string, startIso: string) {
  const client = await prisma.client.create({
    data: {
      businessId: t.businessId,
      name: 'Racer',
      phone: `+96170${String(++conflictSeq).padStart(6, '0')}`,
    },
  });
  const start = new Date(startIso);
  await prisma.appointment.create({
    data: {
      businessId: t.businessId,
      clientId: client.id,
      staffId,
      serviceId,
      startAt: start,
      endAt: new Date(start.getTime() + 30 * 60_000),
      blockedUntil: new Date(start.getTime() + 30 * 60_000),
    },
  });
}

const run = async (p: Promise<unknown>) => {
  try {
    return { ok: true as const, value: await p };
  } catch (e) {
    if (e instanceof AppError) return { ok: false as const, error: e };
    throw e;
  }
};

describe('B2: configuration is validated before any write', () => {
  it('production without LINK_SECRET -> clean 500, no rows; fixing the config makes a retry work', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const payload = bookingBody(serviceId, staffIds[0]!, at('07:00'));
    const before = [await count('Appointment'), await count('Client'), await count('ReminderJob')];

    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_URL', 'https://maw3ed.example');
    vi.stubEnv('LINK_SECRET', '');
    resetServerEnv();
    const key = newKey();
    const bad = await bookPublicly(t.slug, payload, key);
    expect(bad.status).toBe(500);
    expect(bad.body!.error.code).toBe('SERVER_MISCONFIGURED');
    expect(JSON.stringify(bad.body)).not.toMatch(/LINK_SECRET|APP_URL/);
    expect([await count('Appointment'), await count('Client'), await count('ReminderJob')]).toEqual(
      before,
    );

    vi.stubEnv('LINK_SECRET', 'a-valid-production-link-secret-0123456789');
    resetServerEnv();
    const good = await bookPublicly(t.slug, payload, key);
    expect(good.status).toBe(201);
    expect(good.body!.links.manage).toMatch(/^https:\/\/maw3ed\.example\/l\//);
    expect(await count('Appointment')).toBe(before[0]! + 1);
  });

  it('production without APP_URL (or with an http one) -> clean 500, no rows', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const before = [await count('Appointment'), await count('Client'), await count('ReminderJob')];
    for (const appUrl of ['', 'http://localhost:3000']) {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('APP_URL', appUrl);
      vi.stubEnv('LINK_SECRET', 'a-valid-production-link-secret-0123456789');
      resetServerEnv();
      const res = await bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, at('07:00')));
      expect(res.status, appUrl).toBe(500);
      expect(res.body!.error.code).toBe('SERVER_MISCONFIGURED');
      expect([
        await count('Appointment'),
        await count('Client'),
        await count('ReminderJob'),
      ]).toEqual(before);
    }
  });

  it('a short LINK_SECRET is refused even outside production', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const before = await count('Appointment');
    vi.stubEnv('LINK_SECRET', 'too-short');
    resetServerEnv();
    const res = await bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, at('07:00')));
    expect(res.status).toBe(500);
    expect(await count('Appointment')).toBe(before);
  });
});

describe('N1/N2: a lost race rolls everything back and falls through to the next candidate', () => {
  it('23P01 inside the transaction (after the client insert) leaves no Client and no ReminderJobs', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const phone = newPhone();
    const clientsBefore = await count('Client');
    const jobsBefore = await count('ReminderJob');
    const out = await run(
      publicBookingService.book(
        ctx(),
        t.slug,
        bookingBody(serviceId, staffIds[0]!, at('07:00'), { phone }),
        newKey(),
        {
          ...defaultBookDeps,
          // availability said "free"; then someone else takes the slot before our insert
          afterAvailability: () => insertConflict(serviceId, staffIds[0]!, at('07:00')),
        },
      ),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.status).toBe(409);
      expect(out.error.code).toBe('SLOT_TAKEN');
    }
    // the racer's own Client (+1) exists; OURS must not
    expect(await count('Client')).toBe(clientsBefore + 1);
    const ours = await pg.query(`SELECT 1 FROM "Client" WHERE phone = $1`, [
      `+961${phone.replace(/\s/g, '')}`,
    ]);
    expect(ours.rowCount).toBe(0);
    expect(await count('ReminderJob')).toBe(jobsBefore);
  });

  it('"anyone": the first pick loses at the insert (23P01) and the second candidate succeeds', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t, { staff: 2 });
    const first = [...staffIds].sort()[0]!; // pickStaff: fewest bookings, ties -> lowest id
    const second = [...staffIds].sort()[1]!;
    const out = await run(
      publicBookingService.book(
        ctx(),
        t.slug,
        bookingBody(serviceId, 'anyone', at('07:00')),
        newKey(),
        {
          ...defaultBookDeps,
          afterAvailability: () => insertConflict(serviceId, first, at('07:00')),
        },
      ),
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect((out.value as any).appointment.staff.id).toBe(second);
    const rows = await pg.query(
      `SELECT "staffId" FROM "Appointment" WHERE "serviceId" = $1 ORDER BY "createdAt"`,
      [serviceId],
    );
    expect(rows.rows.map((r) => r.staffId)).toEqual([first, second]);
  });

  it('"anyone": when every candidate is lost at the insert, the answer is 409 with fresh slots', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t, { staff: 2 });
    const out = await run(
      publicBookingService.book(
        ctx(),
        t.slug,
        bookingBody(serviceId, 'anyone', at('07:00')),
        newKey(),
        {
          ...defaultBookDeps,
          afterAvailability: async () => {
            for (const s of staffIds) await insertConflict(serviceId, s, at('07:00'));
          },
        },
      ),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('SLOT_TAKEN');
      const slots = (out.error.data as any).slots as { startAt: string }[];
      expect(startsOf(slots)).not.toContain(at('07:00'));
      expect(slots.length).toBeGreaterThan(0);
    }
  });
});

describe('N2: more concurrency and replay pins', () => {
  it('front desk and public booking racing for the same slot: exactly one wins', async () => {
    for (const hhmm of ['08:00', '08:30', '09:00']) {
      const { serviceId, staffIds } = await newScenario(prisma, t);
      const [desk, pub] = await Promise.all([
        bookAtFrontDesk(t.cookie, bookingBody(serviceId, staffIds[0]!, at(hhmm))),
        bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, at(hhmm))),
      ]);
      expect([desk.status, pub.status].sort()).toEqual([201, 409]);
      const loser = desk.status === 409 ? desk : pub;
      expect(loser.body!.error.code).toBe('SLOT_TAKEN');
      expect(
        (await pg.query(`SELECT 1 FROM "Appointment" WHERE "serviceId" = $1`, [serviceId]))
          .rowCount,
      ).toBe(1);
    }
  });

  it('booking while the same slot is being cancelled never yields two active rows', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const first = await bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, at('07:00')));
    const id = first.body!.appointment.id as string;
    const [cancelled, rebook] = await Promise.all([
      call(cancelAppointment, `/api/appointments/${id}/cancel`, {
        method: 'POST',
        cookie: t.cookie,
        params: { id },
      }),
      bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, at('07:00'))),
    ]);
    expect(cancelled.status).toBe(200);
    expect([201, 409]).toContain(rebook.status);
    const active = await pg.query(
      `SELECT 1 FROM "Appointment" WHERE "serviceId" = $1 AND status IN ('BOOKED','CONFIRMED')`,
      [serviceId],
    );
    expect(active.rowCount).toBe(rebook.status === 201 ? 1 : 0);
    // after the dust settles the slot is bookable again if the racer lost
    if (rebook.status === 409) {
      const again = await bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, at('07:00')));
      expect(again.status).toBe(201);
    }
  });

  it('pins: replaying the key of a CANCELLED booking returns 200 with status CANCELLED (no new booking)', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const body = bookingBody(serviceId, staffIds[0]!, at('07:00'));
    const key = newKey();
    const first = await bookPublicly(t.slug, body, key);
    const id = first.body!.appointment.id as string;
    await call(cancelAppointment, `/api/appointments/${id}/cancel`, {
      method: 'POST',
      cookie: t.cookie,
      params: { id },
    });
    const replay = await bookPublicly(t.slug, body, key);
    expect(replay.status).toBe(200);
    expect(replay.body!.appointment.id).toBe(id);
    expect(replay.body!.appointment.status).toBe('CANCELLED');
    expect(
      (await pg.query(`SELECT 1 FROM "Appointment" WHERE "serviceId" = $1`, [serviceId])).rowCount,
    ).toBe(1);
  });

  it('forged start times are all 409 SLOT_TAKEN with fresh slots and write nothing', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    await prisma.timeOff.create({
      data: {
        businessId: t.businessId,
        staffId: staffIds[0]!,
        startAt: new Date(at('11:00')),
        endAt: new Date(at('12:00')),
      },
    });
    const forged = [
      at('07:07'), // off the step grid
      '2026-11-04T07:00:00.001Z', // millisecond offset
      '2026-11-04T07:00:30.000Z', // seconds offset
      '2026-11-01T07:00:00.000Z', // past
      '2026-12-30T07:00:00.000Z', // beyond the booking window
      at('11:15'), // inside time off
      at('10:45'), // would run into the time off
    ];
    for (const startAt of forged) {
      const res = await bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, startAt));
      expect(res.status, startAt).toBe(409);
      expect(res.body!.error.code).toBe('SLOT_TAKEN');
      expect(Array.isArray(res.body!.error.data.slots)).toBe(true);
    }
    const day = await bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, at('11:15')));
    expect(startsOf(day.body!.error.data.slots)).toContain(at('07:00'));
    expect(startsOf(day.body!.error.data.slots)).not.toContain(at('11:15'));
    expect(
      (await pg.query(`SELECT 1 FROM "Appointment" WHERE "serviceId" = $1`, [serviceId])).rowCount,
    ).toBe(0);
  });
});

describe('N5: front-desk walk-ins ignore min notice only', () => {
  const walkIn = '2026-11-02T08:30:00.000Z'; // now is 08:00Z; min notice is 60 min

  it('public is refused inside min notice; front desk is accepted', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const pub = await bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, walkIn));
    expect(pub.status).toBe(409);
    const desk = await bookAtFrontDesk(t.cookie, bookingBody(serviceId, staffIds[0]!, walkIn));
    expect(desk.status).toBe(201);
    // "right now" (start == now, on the grid) works too
    const now = await bookAtFrontDesk(
      t.cookie,
      bookingBody(serviceId, staffIds[0]!, '2026-11-02T08:00:00.000Z'),
    );
    expect(now.status).toBe(201);
    // a walk-in gets only the reminders that still make sense
    const jobs = await pg.query(`SELECT kind FROM "ReminderJob" WHERE "appointmentId" = $1`, [
      desk.body!.appointment.id,
    ]);
    expect(jobs.rows.map((r) => r.kind)).toEqual(['BOOKING']);
  });

  it('front desk still enforces the past, hours, time off, window and the exclusion constraint', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    await prisma.timeOff.create({
      data: {
        businessId: t.businessId,
        staffId: staffIds[0]!,
        startAt: new Date('2026-11-02T13:00:00.000Z'),
        endAt: new Date('2026-11-02T14:00:00.000Z'),
      },
    });
    const refused = [
      '2026-11-02T07:45:00.000Z', // before now
      '2026-11-02T05:00:00.000Z', // before opening
      '2026-11-02T13:15:00.000Z', // time off
      '2026-12-30T07:00:00.000Z', // beyond the window
      '2026-11-02T08:07:00.000Z', // off grid
    ];
    for (const startAt of refused) {
      const res = await bookAtFrontDesk(t.cookie, bookingBody(serviceId, staffIds[0]!, startAt));
      expect(res.status, startAt).toBe(409);
      expect(res.body!.error.code).toBe('SLOT_TAKEN');
    }
    const ok = await bookAtFrontDesk(t.cookie, bookingBody(serviceId, staffIds[0]!, walkIn));
    expect(ok.status).toBe(201);
    const clash = await bookAtFrontDesk(t.cookie, bookingBody(serviceId, staffIds[0]!, walkIn));
    expect(clash.status).toBe(409);
    // the walk-in override does not leak into the public slots endpoint
    const slots = await getSlots(t.slug, { serviceId, from: '2026-11-02', to: '2026-11-02' });
    expect(startsOf(slots.body!.slots)[0]).toBe('2026-11-02T09:00:00.000Z');
  });
});

describe('N2: a STAFF-role session can run the front desk', () => {
  it('lists, reads, books and cancels; owner-only routes stay closed', async () => {
    const invite = await call(createInvite, '/api/invites', {
      cookie: t.cookie,
      body: { email: `staff-${unique()}@example.test`, role: 'STAFF' },
    });
    const token = invite.body!.acceptUrl.split('/invite/')[1] as string;
    const accepted = await call(acceptInvite, `/api/invites/${token}/accept`, {
      params: { token },
      body: { name: 'Receptionist', password: PASSWORD },
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body!.role).toBe('STAFF');
    const cookie = accepted.cookie as string;

    const { serviceId, staffIds } = await newScenario(prisma, t);
    const booked = await bookAtFrontDesk(cookie, bookingBody(serviceId, staffIds[0]!, at('07:00')));
    expect(booked.status).toBe(201);
    const id = booked.body!.appointment.id as string;

    const list = await call(listAppointments, '/api/appointments', {
      cookie,
      query: { from: DAY, to: DAY, staffId: staffIds[0]! },
    });
    expect(list.status).toBe(200);
    expect(list.body!.appointments.map((a: any) => a.id)).toContain(id);

    const one = await call(getAppointment, `/api/appointments/${id}`, { cookie, params: { id } });
    expect(one.status).toBe(200);

    const cancelled = await call(cancelAppointment, `/api/appointments/${id}/cancel`, {
      method: 'POST',
      cookie,
      params: { id },
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body!.appointment.status).toBe('CANCELLED');

    const forbidden = await call(createInvite, '/api/invites', {
      cookie,
      body: { email: 'x@example.test', role: 'STAFF' },
    });
    expect(forbidden.status).toBe(403);
  });
});
