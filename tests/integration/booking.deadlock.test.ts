import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { clientRepo } from '@/server/repositories/client.repo';
import type { PrismaClient } from '../../src/generated/prisma/client';
import {
  at,
  bookAtFrontDesk,
  bookingBody,
  bookPublicly,
  newScenario,
  newTenant,
  NOW,
  type Tenant,
} from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';

// A deadlock victim (Postgres 40P01) of concurrent inserts into appointment_no_overlap used to reach the client
// as 503 SERVICE_BUSY. Its transaction is rolled back, so the booking insert retries (a NEW transaction each
// time, up to 3 attempts); the retry then succeeds or meets the exclusion constraint (409 SLOT_TAKEN).

let pg: Client;
let prisma: PrismaClient;
let t: Tenant;

/** What Prisma's pg driver adapter throws for a deadlock. */
const deadlock = () =>
  Object.assign(new Error('deadlock detected'), {
    code: 'P2010',
    meta: { driverAdapterError: { cause: { originalCode: '40P01', kind: 'postgres' } } },
  });

beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
  await truncateAll(pg);
  prisma = newPrisma();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  t = await newTenant({ businessName: 'Deadlock Salon' });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await pg.end();
});

/** Make the first `n` booking-insert transactions fail with a deadlock, then behave normally. */
function injectDeadlocks(n: number) {
  const real = clientRepo.upsertByPhone.bind(clientRepo);
  let failures = 0;
  const spy = vi.spyOn(clientRepo, 'upsertByPhone').mockImplementation(async (...args) => {
    if (failures < n) {
      failures++;
      throw deadlock();
    }
    return real(...args);
  });
  return spy;
}

describe('booking insert: deadlock victim is retried', () => {
  it('one deadlock on the first attempt: the public booking still succeeds (never 503)', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const spy = injectDeadlocks(1);
    const res = await bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, at('08:00')));
    expect(res.status).toBe(201);
    expect(spy).toHaveBeenCalledTimes(2);
    const rows = await pg.query(`SELECT 1 FROM "Appointment" WHERE "staffId" = $1`, [staffIds[0]]);
    expect(rows.rowCount).toBe(1); // exactly one appointment: the failed attempt left nothing behind
  });

  it('a deadlock, then the slot is taken: 409 SLOT_TAKEN with fresh slots, not 503', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const first = await bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, at('09:00')));
    expect(first.status).toBe(201);
    injectDeadlocks(1);
    const res = await bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, at('09:00')));
    expect(res.status).toBe(409);
    expect(res.body!.error.code).toBe('SLOT_TAKEN');
    expect(Array.isArray(res.body!.error.data.slots)).toBe(true);
  });

  it('the front desk shares the same insert and the same retry', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    injectDeadlocks(2);
    const res = await bookAtFrontDesk(t.cookie, bookingBody(serviceId, staffIds[0]!, at('10:00')));
    expect(res.status).toBe(201);
  });

  it('gives up after 3 attempts with the usual 503 SERVICE_BUSY', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    const spy = injectDeadlocks(99);
    const res = await bookPublicly(t.slug, bookingBody(serviceId, staffIds[0]!, at('11:00')));
    expect(res.status).toBe(503);
    expect(res.body!.error.code).toBe('SERVICE_BUSY');
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('15 rounds of 10 parallel bookings for one slot: always 1x201 + 9x409, never a 503', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t, { staff: 5 });
    const times = ['07:00', '07:30', '08:00'];
    for (let r = 0; r < 15; r++) {
      const staff = staffIds[r % 5]!;
      const time = times[Math.floor(r / 5)]!;
      const res = await Promise.all(
        Array.from({ length: 10 }, () =>
          bookPublicly(t.slug, bookingBody(serviceId, staff, at(time, '2026-11-06'))),
        ),
      );
      expect(res.map((x) => x.status).sort(), `round ${r}`).toEqual([
        201, 409, 409, 409, 409, 409, 409, 409, 409, 409,
      ]);
    }
  }, 60_000);
});
