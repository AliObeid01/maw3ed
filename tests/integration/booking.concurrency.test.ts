import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import type { PrismaClient } from '../../src/generated/prisma/client';
import {
  at,
  bookingBody,
  bookPublicly,
  getSlots,
  newKey,
  newScenario,
  newTenant,
  NOW,
  startsOf,
  DAY,
  type Tenant,
} from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';

// Guarantees 1 and 2 end to end: one slot, many racers; one idempotency key, many retries.

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

const activeRows = async (serviceId: string) =>
  (
    await pg.query(
      `SELECT id, "staffId" FROM "Appointment" WHERE "serviceId" = $1 AND status IN ('BOOKED','CONFIRMED')`,
      [serviceId],
    )
  ).rows;

describe('FR-10: concurrent requests for one slot', () => {
  it('10 parallel POSTs for one slot -> exactly one 201 and nine 409 SLOT_TAKEN with fresh slots', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const start = at('07:00'); // 09:00 Beirut
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, start)),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409, 409, 409, 409, 409]);

    const losers = results.filter((r) => r.status === 409);
    for (const r of losers) {
      expect(r.body!.error.code).toBe('SLOT_TAKEN');
      const slots = r.body!.error.data.slots as { startAt: string; staffId?: string }[];
      expect(slots.length).toBeGreaterThan(0);
      expect(startsOf(slots)).not.toContain(start);
      expect(startsOf(slots)).toContain(at('07:30'));
    }
    const rows = await activeRows(serviceId);
    expect(rows).toHaveLength(1);
    const winner = results.find((r) => r.status === 201)!;
    expect(rows[0]!.id).toBe(winner.body!.appointment.id);
  });

  it('"anyone" with 2 staff: two parallel requests land on different staff, a third gets 409', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t, { staff: 2 });
    const start = at('08:00');
    const results = await Promise.all(
      [0, 1].map(() => bookPublicly(t.slug, bookingBody(serviceId, 'anyone', start))),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    const used = results.map((r) => r.body!.appointment.staff.id as string);
    expect(new Set(used).size).toBe(2);
    expect(new Set(used)).toEqual(new Set(staffIds));

    const third = await bookPublicly(t.slug, bookingBody(serviceId, 'anyone', start));
    expect(third.status).toBe(409);
    expect(third.body!.error.code).toBe('SLOT_TAKEN');
    expect(startsOf(third.body!.error.data.slots)).not.toContain(start);
    expect(await activeRows(serviceId)).toHaveLength(2);
  });

  it('3 parallel "anyone" requests with 2 staff: two succeed on different staff, one 409', async () => {
    const { serviceId } = await newScenario(prisma, t, { staff: 2 });
    const start = at('08:15');
    const results = await Promise.all(
      [0, 1, 2].map(() => bookPublicly(t.slug, bookingBody(serviceId, 'anyone', start))),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 201, 409]);
    expect(await activeRows(serviceId)).toHaveLength(2);
  });
});

describe('Idempotency-Key', () => {
  it('the same key twice IN PARALLEL returns the same appointment and creates one row', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const body = bookingBody(serviceId, staffIds[0]!, at('09:00'));
    const key = newKey();
    const results = await Promise.all([
      bookPublicly(t.slug, body, key),
      bookPublicly(t.slug, body, key),
      bookPublicly(t.slug, body, key),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 201]);
    const ids = new Set(results.map((r) => r.body!.appointment.id));
    expect(ids.size).toBe(1);
    expect(await activeRows(serviceId)).toHaveLength(1);
  });

  it('the same key sequentially returns the first appointment with 200 (not 201, not 409)', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const body = bookingBody(serviceId, staffIds[0]!, at('09:00'));
    const key = newKey();
    const first = await bookPublicly(t.slug, body, key);
    const second = await bookPublicly(t.slug, body, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body!.appointment.id).toBe(first.body!.appointment.id);
    expect(await activeRows(serviceId)).toHaveLength(1);
  });

  it('"anyone" retried with the same key returns the first booking', async () => {
    const { serviceId } = await newScenario(prisma, t, { staff: 2 });
    const body = bookingBody(serviceId, 'anyone', at('09:30'));
    const key = newKey();
    const first = await bookPublicly(t.slug, body, key);
    const second = await bookPublicly(t.slug, body, key);
    expect([first.status, second.status]).toEqual([201, 200]);
    expect(second.body!.appointment.id).toBe(first.body!.appointment.id);
    expect(await activeRows(serviceId)).toHaveLength(1);
  });

  it('the same key with a different body -> 422 IDEMPOTENCY_KEY_REUSED and no second row', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const key = newKey();
    const phone = '71 555 123';
    const first = await bookPublicly(
      t.slug,
      bookingBody(serviceId, staffIds[0]!, at('09:00'), { phone }),
      key,
    );
    expect(first.status).toBe(201);
    const other = await bookPublicly(
      t.slug,
      bookingBody(serviceId, staffIds[0]!, at('10:00'), { phone }),
      key,
    );
    expect(other.status).toBe(422);
    expect(other.body!.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await activeRows(serviceId)).toHaveLength(1);
  });

  it('is scoped per business: another business may reuse the key', async () => {
    const other = await newTenant();
    const a = await newScenario(prisma, t);
    const b = await newScenario(prisma, other);
    const key = newKey();
    const ra = await bookPublicly(t.slug, bookingBody(a.serviceId, a.staffIds[0]!, at('09:00')), key);
    const rb = await bookPublicly(
      other.slug,
      bookingBody(b.serviceId, b.staffIds[0]!, at('09:00')),
      key,
    );
    expect([ra.status, rb.status]).toEqual([201, 201]);
    expect(ra.body!.appointment.id).not.toBe(rb.body!.appointment.id);
  });
});

describe('slots reflect bookings', () => {
  it('a booked slot disappears from the slots endpoint (specific staff and "anyone")', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const q = { serviceId, from: DAY, to: DAY };
    const before = await getSlots(t.slug, q);
    expect(before.status).toBe(200);
    expect(startsOf(before.body!.slots)).toContain(at('10:00'));

    const res = await bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, at('10:00')));
    expect(res.status).toBe(201);

    const anyone = await getSlots(t.slug, q);
    expect(startsOf(anyone.body!.slots)).not.toContain(at('10:00'));
    expect(startsOf(anyone.body!.slots)).toContain(at('10:30'));
    const named = await getSlots(t.slug, { ...q, staffId: staffIds[0]! });
    expect(startsOf(named.body!.slots)).not.toContain(at('10:00'));
  });

  it('the buffer blocks the adjacent slot', async () => {
    // 30 min service + 15 min buffer, 15 min step: booking 09:00 (local) blocks until 09:45
    const { serviceId, staffIds } = await newScenario(prisma, t, { bufferMin: 15 });
    const res = await bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, at('07:00')));
    expect(res.status).toBe(201);
    const slots = await getSlots(t.slug, { serviceId, from: DAY, to: DAY });
    const starts = startsOf(slots.body!.slots);
    expect(starts).not.toContain(at('07:00'));
    expect(starts).not.toContain(at('07:15'));
    expect(starts).not.toContain(at('07:30'));
    expect(starts).toContain(at('07:45'));
    // and booking into the buffer is refused
    const clash = await bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, at('07:30')));
    expect(clash.status).toBe(409);
    const rows = await pg.query(
      `SELECT "blockedUntil", "endAt" FROM "Appointment" WHERE "serviceId" = $1`,
      [serviceId],
    );
    expect(rows.rows[0].blockedUntil.toISOString()).toBe(at('07:45'));
    expect(rows.rows[0].endAt.toISOString()).toBe(at('07:30'));
  });
});
