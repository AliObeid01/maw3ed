/* eslint-disable @typescript-eslint/no-explicit-any -- patching the pg driver to count queries */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pgDriver from 'pg';
import type { Client } from 'pg';
import { GET as publicBusiness } from '@/app/api/public/[slug]/route';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call } from './helpers/api';
import {
  at,
  DAY,
  getSlots,
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
let other: Tenant;

beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
  await truncateAll(pg);
  prisma = newPrisma();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  t = await newTenant({ slug: 'studio-read' });
  other = await newTenant({ slug: 'studio-other' });
});
afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await pg.end();
});

const getBusiness = (slug: string) =>
  call(publicBusiness, `/api/public/${slug}`, { params: { slug } });

describe('GET /api/public/{slug}', () => {
  it('returns the business, active services and bookable active staff only', async () => {
    await prisma.business.update({
      where: { id: t.businessId },
      data: { category: 'Salon', area: 'sidon', address: 'Hamra, Beirut' },
    });
    const { serviceId, staffIds } = await newScenario(prisma, t, { staff: 2 });
    const hiddenService = await prisma.service.create({
      data: { businessId: t.businessId, name: 'Retired', durationMin: 20, active: false },
    });
    await prisma.staffMember.update({ where: { id: staffIds[1]! }, data: { bookable: false } });
    const inactive = await prisma.staffMember.create({
      data: { businessId: t.businessId, displayName: 'Gone', active: false },
    });
    await prisma.staffService.create({
      data: { businessId: t.businessId, staffId: inactive.id, serviceId },
    });
    await newScenario(prisma, other); // other business data must never leak

    const res = await getBusiness('studio-read');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.body!.business).toEqual({
      name: t.info.business.name,
      slug: 'studio-read',
      timezone: 'Asia/Beirut',
      locale: 'en',
      bookingWindowDays: 30,
      cancelCutoffMin: 1440,
      category: 'Salon',
      area: 'sidon',
      address: 'Hamra, Beirut',
    });
    const serviceIds = res.body!.services.map((s: any) => s.id);
    expect(serviceIds).toContain(serviceId);
    expect(serviceIds).not.toContain(hiddenService.id);
    const svc = res.body!.services.find((s: any) => s.id === serviceId);
    expect(svc).toEqual({
      id: serviceId,
      name: expect.any(String),
      durationMin: 30,
      bufferMin: 0,
      price: 15,
    });
    const staffOut = res.body!.staff.map((s: any) => s.id);
    expect(staffOut).toContain(staffIds[0]);
    expect(staffOut).not.toContain(staffIds[1]);
    expect(staffOut).not.toContain(inactive.id);
    expect(res.body!.staff.find((s: any) => s.id === staffIds[0]).serviceIds).toEqual([serviceId]);
    expect(JSON.stringify(res.body)).not.toContain(other.businessId);
    expect(JSON.stringify(res.body)).not.toMatch(/businessId|email|passwordHash/);
  });

  it('omits category and address when unset, and an unknown slug is 404', async () => {
    const res = await getBusiness('studio-other');
    expect(res.status).toBe(200);
    expect(res.body!.business).not.toHaveProperty('category');
    expect(res.body!.business).not.toHaveProperty('area');
    expect(res.body!.business).not.toHaveProperty('address');
    const missing = await getBusiness('no-such-business');
    expect(missing.status).toBe(404);
    expect(missing.body!.error.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/public/{slug}/slots', () => {
  it('"anyone" returns distinct starts without staff ids; a named staff member gets staffId', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t, { staff: 2 });
    const anyone = await getSlots(t.slug, { serviceId, from: DAY, to: DAY });
    expect(anyone.status).toBe(200);
    expect(anyone.headers.get('cache-control')).toBe('no-store');
    const starts = startsOf(anyone.body!.slots);
    expect(new Set(starts).size).toBe(starts.length); // two staff, one entry per start
    expect(starts).toHaveLength(31);
    expect(starts[0]).toBe(at('07:00'));
    for (const s of anyone.body!.slots) expect(Object.keys(s).sort()).toEqual(['endAt', 'startAt']);
    expect(anyone.body!.slots[0].endAt).toBe(at('07:30'));

    const named = await getSlots(t.slug, { serviceId, staffId: staffIds[0]!, from: DAY, to: DAY });
    expect(named.body!.slots[0]).toEqual({
      startAt: at('07:00'),
      endAt: at('07:30'),
      staffId: staffIds[0],
    });
  });

  it('subtracts time off and never offers past or min-notice starts', async () => {
    const { serviceId, staffIds } = await newScenario(prisma, t);
    await prisma.timeOff.create({
      data: {
        businessId: t.businessId,
        staffId: staffIds[0]!,
        startAt: new Date(at('09:00')), // 11:00 local
        endAt: new Date(at('10:00')),
      },
    });
    const day = await getSlots(t.slug, { serviceId, from: DAY, to: DAY });
    const starts = startsOf(day.body!.slots);
    expect(starts).toContain(at('08:30')); // ends exactly when the time off starts
    expect(starts).not.toContain(at('08:45')); // would overlap it
    expect(starts).not.toContain(at('09:00'));
    expect(starts).not.toContain(at('09:30'));
    expect(starts).toContain(at('10:00'));

    // today (2 Nov): now is 10:00 local, min notice 60 -> earliest 09:00Z (11:00 local)
    const today = await getSlots(t.slug, { serviceId, from: '2026-11-02', to: '2026-11-02' });
    expect(startsOf(today.body!.slots)[0]).toBe('2026-11-02T09:00:00.000Z');
    const yesterday = await getSlots(t.slug, { serviceId, from: '2026-11-01', to: '2026-11-01' });
    expect(yesterday.body!.slots).toEqual([]);
  });

  it('accepts exactly 31 days, rejects 32, and rejects `to` beyond bookingWindowDays', async () => {
    const { serviceId } = await newScenario(prisma, t);
    const ok = await getSlots(t.slug, { serviceId, from: '2026-11-02', to: '2026-12-02' }); // 31 days, window ends 2 Dec
    expect(ok.status).toBe(200);
    const tooLong = await getSlots(t.slug, { serviceId, from: '2026-11-02', to: '2026-12-03' });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body!.error.fields.to).toBeTruthy();
    const beyond = await getSlots(t.slug, { serviceId, from: '2026-12-03', to: '2026-12-04' });
    expect(beyond.status).toBe(400);
    expect(beyond.body!.error.fields.to).toMatch(/30 days/);
    const inverted = await getSlots(t.slug, { serviceId, from: '2026-11-05', to: '2026-11-04' });
    expect(inverted.status).toBe(400);
  });

  it('400 for bad query: missing params, bad dates, unknown fields, malformed ids', async () => {
    const { serviceId } = await newScenario(prisma, t);
    const cases: Record<string, string>[] = [
      {},
      { serviceId },
      { serviceId, from: '2026-11-04' },
      { serviceId, from: '04/11/2026', to: '05/11/2026' },
      { serviceId, from: '2026-02-30', to: '2026-03-01' },
      { serviceId: 'not an id!', from: DAY, to: DAY },
      { serviceId, from: DAY, to: DAY, extra: '1' },
      { serviceId, from: DAY, to: DAY, businessId: other.businessId },
    ];
    for (const query of cases) {
      const res = await getSlots(t.slug, query);
      expect(res.status, JSON.stringify(query)).toBe(400);
      expect(res.body!.error.code).toBe('VALIDATION_FAILED');
      expect(Object.keys(res.body!.error.fields).length).toBeGreaterThan(0);
    }
  });

  it('404 for an unknown slug, another business’s service, or another business’s staff', async () => {
    const mine = await newScenario(prisma, t);
    const theirs = await newScenario(prisma, other);
    expect(
      (await getSlots('no-such-business', { serviceId: mine.serviceId, from: DAY, to: DAY }))
        .status,
    ).toBe(404);
    expect(
      (await getSlots(t.slug, { serviceId: theirs.serviceId, from: DAY, to: DAY })).status,
    ).toBe(404);
    expect(
      (
        await getSlots(t.slug, {
          serviceId: mine.serviceId,
          staffId: theirs.staffIds[0]!,
          from: DAY,
          to: DAY,
        })
      ).status,
    ).toBe(404);
  });
});

/** Count statements sent to Postgres through the pg driver (BEGIN/COMMIT/SET excluded). */
async function countQueries<T>(fn: () => Promise<T>) {
  const proto = pgDriver.Client.prototype as any;
  const original = proto.query;
  const seen: string[] = [];
  proto.query = function (this: unknown, ...args: any[]) {
    const text = typeof args[0] === 'string' ? args[0] : args[0]?.text;
    if (text && !/^\s*(BEGIN|COMMIT|ROLLBACK|SET\b|SHOW\b)/i.test(text)) seen.push(text);
    return original.apply(this, args);
  };
  try {
    return { result: await fn(), count: seen.length, seen };
  } finally {
    proto.query = original;
  }
}

describe('NFR-09: the loader uses a fixed number of queries', () => {
  it('a 14-day "anyone" request is <= 8 queries and does not grow with the staff count', async () => {
    const small = await newScenario(prisma, t, { staff: 1 });
    const large = await newScenario(prisma, t, { staff: 10 });
    // warm the connection so the count is steady
    await getSlots(t.slug, { serviceId: small.serviceId, from: '2026-11-03', to: '2026-11-16' });

    const a = await countQueries(() =>
      getSlots(t.slug, { serviceId: small.serviceId, from: '2026-11-03', to: '2026-11-16' }),
    );
    const b = await countQueries(() =>
      getSlots(t.slug, { serviceId: large.serviceId, from: '2026-11-03', to: '2026-11-16' }),
    );
    expect(a.result.status).toBe(200);
    expect(b.result.status).toBe(200);
    console.log(`slots queries: 1 staff = ${a.count}, 10 staff = ${b.count}`);
    expect(a.count).toBeGreaterThan(0);
    expect(a.count).toBeLessThanOrEqual(8);
    expect(b.count).toBe(a.count);
  });
});
