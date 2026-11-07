/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { GET as getLink } from '@/app/api/links/[token]/route';
import { GET as getAppointment } from '@/app/api/appointments/[id]/route';
import { GET as listAppointments } from '@/app/api/appointments/route';
import { expiryFor, signToken } from '@/server/domain/tokens';
import { isReference } from '@/server/domain/reference';
import { rootLogger } from '@/server/http/logger';
import { book, defaultBookDeps, type BookDeps } from '@/server/services/booking';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call } from './helpers/api';
import {
  at,
  bookAtFrontDesk,
  bookingBody,
  bookPublicly,
  newKey,
  newPhone,
  newScenario,
  newTenant,
  NOW,
  type Tenant,
} from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';

// PR-6 part A: every appointment gets a short reference inside the ONE booking insert. A collision on the
// reference index retries; a collision on the idempotency key or appointment_no_overlap never does.

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

const refOf = async (id: string) =>
  (await pg.query(`SELECT reference FROM "Appointment" WHERE id = $1`, [id])).rows[0]?.reference as
    string | null;

const ctx = () => ({ businessId: t.businessId, requestId: 'req-ref', logger: rootLogger });
const bookInput = (serviceId: string, staffId: string, startAt: string, key?: string) => ({
  serviceId,
  staffId,
  startAt: new Date(startAt),
  client: { name: 'Ref Client', phone: newPhone(), email: 'ref@example.test' },
  source: 'PUBLIC' as const,
  idempotencyKey: key,
});
const withReference = (refs: string[]): BookDeps => {
  const queue = [...refs];
  return { ...defaultBookDeps, newReference: () => queue.shift() ?? 'ZZZZZZ' };
};

describe('every booking path gets a reference', () => {
  it('public booking: response and row carry the same valid reference', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const res = await bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, at('07:00')));
    expect(res.status).toBe(201);
    const ref = res.body!.appointment.reference as string;
    expect(isReference(ref)).toBe(true);
    expect(await refOf(res.body!.appointment.id)).toBe(ref);
  });

  it('front-desk booking gets one too', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const res = await bookAtFrontDesk(t.cookie, bookingBody(serviceId, staffIds[0]!, at('07:30')));
    expect(res.status).toBe(201);
    expect(isReference(res.body!.appointment.reference)).toBe(true);
  });

  it('an idempotent retry returns the SAME reference (200 replay), also a parallel one', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const body = bookingBody(serviceId, staffIds[0]!, at('08:00'));
    const key = newKey();
    const first = await bookPublicly(t.slug, body, key);
    const again = await bookPublicly(t.slug, body, key);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body!.appointment.reference).toBe(first.body!.appointment.reference);

    const body2 = bookingBody(serviceId, staffIds[0]!, at('08:30'));
    const key2 = newKey();
    const racers = await Promise.all(
      Array.from({ length: 5 }, () => bookPublicly(t.slug, body2, key2)),
    );
    expect(racers.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(racers.map((r) => r.body!.appointment.reference)).size).toBe(1);
  });

  it('10 parallel bookings for one slot: still 1x201 and 9x409; 10 different slots: 10 unique references', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const same = await Promise.all(
      Array.from({ length: 10 }, () =>
        bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, at('09:00'))),
      ),
    );
    expect(same.map((r) => r.status).sort()).toEqual([
      201, 409, 409, 409, 409, 409, 409, 409, 409, 409,
    ]);
    for (const r of same.filter((x) => x.status === 409))
      expect(r.body!.error.code).toBe('SLOT_TAKEN');

    const slots = [
      '09:30',
      '10:00',
      '10:30',
      '11:00',
      '11:30',
      '12:00',
      '12:30',
      '13:00',
      '13:30',
      '14:00',
    ];
    const many = await Promise.all(
      slots.map((s) => bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, at(s)))),
    );
    expect(many.every((r) => r.status === 201)).toBe(true);
    const refs = many.map((r) => r.body!.appointment.reference as string);
    expect(new Set(refs).size).toBe(10);
    const stored = await pg.query(
      `SELECT count(*)::int AS n, count(DISTINCT reference)::int AS d FROM "Appointment" WHERE "serviceId" = $1`,
      [serviceId],
    );
    expect(stored.rows[0]).toEqual({ n: 11, d: 11 });
  });
});

describe('a reference collision retries the insert only', () => {
  it('retries with a new code and the booking succeeds (not SLOT_TAKEN, not a replay)', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const first = await book(
      ctx(),
      bookInput(serviceId, staffIds[0]!, at('07:00', '2026-11-05')),
      withReference(['COLLID']),
    );
    expect(first.appointment.reference).toBe('COLLID');
    const second = await book(
      ctx(),
      bookInput(serviceId, staffIds[0]!, at('07:30', '2026-11-05'), newKey()),
      withReference(['COLLID', 'COLLID', 'FRESH2']),
    );
    expect(second.replay).toBe(false);
    expect(second.appointment.reference).toBe('FRESH2');
    expect(second.appointment.id).not.toBe(first.appointment.id);
    // Exactly one client row per phone and no half-written appointment left behind.
    const rows = await pg.query(
      `SELECT count(*)::int AS n FROM "Appointment" WHERE "serviceId" = $1`,
      [serviceId],
    );
    expect(rows.rows[0].n).toBe(2);
  });

  it('gives up after 5 collisions with a 503 (nothing is stored)', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    await book(
      ctx(),
      bookInput(serviceId, staffIds[0]!, at('08:00', '2026-11-05')),
      withReference(['TAKEN2']),
    );
    await expect(
      book(
        ctx(),
        bookInput(serviceId, staffIds[0]!, at('08:30', '2026-11-05')),
        withReference(Array(5).fill('TAKEN2')),
      ),
    ).rejects.toMatchObject({ status: 503 });
    const rows = await pg.query(
      `SELECT count(*)::int AS n FROM "Appointment" WHERE "serviceId" = $1`,
      [serviceId],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it('a real slot clash is still 409 SLOT_TAKEN and is NOT retried as a reference collision', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    await book(
      ctx(),
      bookInput(serviceId, staffIds[0]!, at('09:00', '2026-11-05')),
      withReference(['SLOTAA']),
    );
    let calls = 0;
    const deps: BookDeps = {
      ...defaultBookDeps,
      newReference: () => `RF${++calls}ABC`.slice(0, 6).replace('1', 'B'),
    };
    await expect(
      book(ctx(), bookInput(serviceId, staffIds[0]!, at('09:00', '2026-11-05')), deps),
    ).rejects.toMatchObject({ status: 409, code: 'SLOT_TAKEN' });
    expect(calls).toBeLessThanOrEqual(1);
  });
});

describe('where the reference is shown', () => {
  it('link view, staff detail and staff list carry it; nothing can be looked up BY it', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const res = await bookPublicly(
      t.slug,
      bookingBody(serviceId, staffIds[0]!, at('07:00', '2026-11-06')),
    );
    const a = res.body!.appointment;
    const token = signToken(
      { a: a.id, act: 'view', exp: expiryFor(new Date(a.startAt)) },
      process.env.LINK_SECRET!,
    );
    const link = await call(getLink, `/api/links/${token}`, { params: { token } });
    expect(link.status).toBe(200);
    expect(link.body!.appointment.reference).toBe(a.reference);

    const one = await call(getAppointment, `/api/appointments/${a.id}`, {
      cookie: t.cookie,
      params: { id: a.id },
    });
    expect(one.body!.appointment.reference).toBe(a.reference);

    const list = await call(listAppointments, '/api/appointments', {
      cookie: t.cookie,
      query: { from: '2026-11-06', to: '2026-11-06' },
    });
    expect(list.body!.appointments.find((x: any) => x.id === a.id).reference).toBe(a.reference);

    // The reference is a label, not a credential: using it as an id or a token finds nothing.
    const asId = await call(getAppointment, `/api/appointments/${a.reference}`, {
      cookie: t.cookie,
      params: { id: a.reference },
    });
    expect([400, 404]).toContain(asId.status);
    const asToken = await call(getLink, `/api/links/${a.reference}`, {
      params: { token: a.reference },
    });
    expect(asToken.status).toBeGreaterThanOrEqual(400);
  });
});
