/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { GET as categories } from '@/app/api/public/categories/route';
import { CATEGORY_KEYS } from '@/lib/business/profile';
import { call } from './helpers/api';
import { newClient, setupSchema, truncateAll } from './helpers/db';
import { makeBusiness } from './helpers/directory';

// PR-10 part G: popular services are ranked by RECENT DEMAND (appointments booked in the last 30 days).
const NOW = new Date('2026-11-02T08:00:00Z');
const DAY = 86_400_000;
const ago = (days: number, extraMs = 0) => new Date(NOW.getTime() - days * DAY - extraMs);

let pg: Client;
beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
});
afterAll(async () => {
  await pg.end();
});
beforeEach(async () => {
  await truncateAll(pg);
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});
afterEach(() => vi.useRealTimers());

let minute = 0;
/** `count` appointments on the business's service `serviceIdx`, created at `createdAt`, in distinct future slots. */
async function bookings(
  biz: { id: string; serviceIds: string[]; staffIds: string[] },
  serviceIdx: number,
  count: number,
  opts: { status?: string; createdAt?: Date } = {},
) {
  await pg.query(
    `INSERT INTO "Client" (id, "businessId", name, phone, "updatedAt")
     VALUES ($1, $2, 'Fixture Client', '+96171000000', now()) ON CONFLICT DO NOTHING`,
    [`${biz.id}-demand-client`, biz.id],
  );
  for (let i = 0; i < count; i++) {
    const start = new Date(Date.UTC(2031, 0, 1) + ++minute * 60_000);
    await pg.query(
      `INSERT INTO "Appointment" (id, "businessId", "clientId", "staffId", "serviceId", "startAt", "endAt", "blockedUntil", status, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8::"AppointmentStatus",$9, now())`,
      [
        `dem-${minute}`,
        biz.id,
        `${biz.id}-demand-client`,
        biz.staffIds[0],
        biz.serviceIds[serviceIdx],
        start,
        new Date(start.getTime() + 60_000),
        opts.status ?? 'BOOKED',
        opts.createdAt ?? ago(1),
      ],
    );
  }
}

const cats = (query: Record<string, string> = {}) =>
  call(categories, '/api/public/categories', { query });
const popular = async (category = 'barbers', query: Record<string, string> = {}) => {
  const res = await cats(query);
  expect(res.status).toBe(200);
  return res.body!.categories.find((c: any) => c.category === category).popularServices as {
    name: string;
    fromPrice: number;
  }[];
};
const keys = (list: { name: string }[]) => list.map((s) => s.name.toLowerCase());
const svc = (name: string, price = 10) => ({ name, durationMin: 30, price });

describe('popular services: ranked by recent bookings', () => {
  it('bookings beat the number of businesses offering the service', async () => {
    const a = await makeBusiness(pg, { name: 'A', services: [svc('Haircut'), svc('Shave')] });
    await makeBusiness(pg, { name: 'B', services: [svc('Haircut')] });
    await makeBusiness(pg, { name: 'C', services: [svc('Haircut')] });
    await bookings(a, 1, 3); // Shave: 1 business, 3 bookings; Haircut: 3 businesses, none
    expect(keys(await popular())).toEqual(['shave', 'haircut']);
  });

  it('counts BOOKED, CONFIRMED, ATTENDED, NO_SHOW, LATE_CANCEL; never CANCELLED or PENDING_PAYMENT', async () => {
    const a = await makeBusiness(pg, {
      name: 'A',
      services: [
        svc('Real demand'),
        svc('Four booked'),
        svc('Cancelled lots'),
        svc('Pending lots'),
      ],
    });
    for (const status of ['BOOKED', 'CONFIRMED', 'ATTENDED', 'NO_SHOW', 'LATE_CANCEL'])
      await bookings(a, 0, 1, { status });
    await bookings(a, 1, 4);
    await bookings(a, 2, 20, { status: 'CANCELLED' });
    await bookings(a, 3, 20, { status: 'PENDING_PAYMENT' });
    const list = keys(await popular());
    expect(list.slice(0, 2)).toEqual(['real demand', 'four booked']);
    // The last two have no demand at all: they only tie-break among themselves (price, then key).
    expect(list.slice(2)).toEqual(['cancelled lots', 'pending lots']);
  });

  it('window: created exactly 30 days ago counts, 31 days ago does not', async () => {
    const a = await makeBusiness(pg, {
      name: 'A',
      services: [svc('Day thirty', 30), svc('Day thirty-one', 1), svc('Day twenty-nine', 20)],
    });
    await bookings(a, 0, 2, { createdAt: ago(30) }); // exactly the boundary: in
    await bookings(a, 1, 5, { createdAt: ago(31) }); // out
    await bookings(a, 1, 5, { createdAt: ago(30, 1) }); // one millisecond older than the boundary: out
    await bookings(a, 2, 1, { createdAt: ago(29) });
    expect(keys(await popular())).toEqual(['day thirty', 'day twenty-nine', 'day thirty-one']);
  });

  it('ties: equal bookings -> more businesses -> lower price -> name', async () => {
    const a = await makeBusiness(pg, {
      name: 'A',
      services: [
        svc('Zz cheap', 5),
        svc('Aa pricey', 50),
        svc('Two shops', 90),
        svc('Mm', 20),
        svc('Bb', 20),
      ],
    });
    await makeBusiness(pg, { name: 'B', services: [svc('Two shops', 95)] });
    for (const i of [0, 1, 3, 4]) await bookings(a, i, 1);
    await bookings(a, 2, 1); // Two shops: 1 booking from A ...
    const list = await popular();
    // All five tie on 1 booking. Two shops has 2 businesses -> first; then price 5, 20, 20 (name), 50.
    expect(keys(list)).toEqual(['two shops', 'zz cheap', 'bb', 'mm', 'aa pricey']);
    expect(list[0]).toEqual({ name: 'Two shops', fromPrice: 90 });
  });

  it('names are normalised (case and surrounding spaces) and add up across businesses', async () => {
    const a = await makeBusiness(pg, { name: 'A', services: [svc('Haircut'), svc('Fade')] });
    const b = await makeBusiness(pg, { name: 'B', services: [svc('  haircut ')] });
    await bookings(a, 0, 1);
    await bookings(b, 0, 2);
    await bookings(a, 1, 2);
    expect(keys(await popular())[0]).toBe('haircut'); // 3 bookings across both spellings beat Fade's 2
  });

  it('bookings in another category do not count', async () => {
    const barber = await makeBusiness(pg, { name: 'Barber', services: [svc('Cut'), svc('Beard')] });
    const spa = await makeBusiness(pg, {
      name: 'Spa',
      category: 'spa-massage',
      services: [svc('Cut')],
    });
    await bookings(spa, 0, 30); // same service name, other category
    await bookings(barber, 1, 1);
    expect(keys(await popular('barbers'))).toEqual(['beard', 'cut']);
    expect(keys(await popular('spa-massage'))).toEqual(['cut']);
  });

  it('area narrows the demand to that area', async () => {
    const beirut = await makeBusiness(pg, {
      name: 'Beirut',
      area: 'beirut',
      services: [svc('Cut'), svc('Beard')],
    });
    const sidon = await makeBusiness(pg, {
      name: 'Sidon',
      area: 'sidon',
      services: [svc('Cut'), svc('Beard')],
    });
    await bookings(beirut, 1, 1); // Beard in Beirut
    await bookings(sidon, 0, 5); // Cut in Sidon
    expect(keys(await popular('barbers', { area: 'beirut' }))).toEqual(['beard', 'cut']);
    expect(keys(await popular('barbers', { area: 'sidon' }))).toEqual(['cut', 'beard']);
    expect(keys(await popular('barbers'))).toEqual(['cut', 'beard']);
  });

  it('with no bookings at all the ranking is the old one: businesses offering it, then price, then name', async () => {
    await makeBusiness(pg, { name: 'A', services: [svc('Haircut', 15), svc('Shave', 9)] });
    await makeBusiness(pg, { name: 'B', services: [svc('haircut', 12)] });
    const list = await popular();
    expect(keys(list)).toEqual(['haircut', 'shave']);
    expect(list[0]!.fromPrice).toBe(12);
  });

  it('unlisted and not-ready businesses and inactive services never count or appear', async () => {
    const hidden = await makeBusiness(pg, {
      name: 'Hidden',
      listed: false,
      services: [svc('Ghost')],
    });
    const notReady = await makeBusiness(pg, {
      name: 'Not ready',
      staff: [{ hours: [] }],
      services: [svc('Ghost2')],
    });
    const real = await makeBusiness(pg, {
      name: 'Real',
      services: [svc('Visible'), { name: 'Retired', durationMin: 30, price: 1, active: false }],
    });
    await bookings(hidden, 0, 9);
    await bookings(notReady, 0, 9);
    await bookings(real, 1, 9); // bookings of an inactive service
    expect(keys(await popular())).toEqual(['visible']);
  });

  it('top 5 per category', async () => {
    const a = await makeBusiness(pg, {
      name: 'A',
      services: Array.from({ length: 8 }, (_, i) => svc(`S${i}`, 10 + i)),
    });
    for (let i = 0; i < 8; i++) await bookings(a, i, i + 1);
    expect(keys(await popular())).toEqual(['s7', 's6', 's5', 's4', 's3']);
  });
});

describe('popular services: contract unchanged, no counts leak', () => {
  it('every key is returned (zero places included) and a popular entry is exactly {name, fromPrice}', async () => {
    const a = await makeBusiness(pg, { name: 'A', services: [svc('Haircut', 15)] });
    await bookings(a, 0, 7);
    const res = await cats();
    expect(res.body!.categories.map((c: any) => c.category)).toEqual([...CATEGORY_KEYS]);
    expect(CATEGORY_KEYS).toHaveLength(7);
    const barbers = res.body!.categories.find((c: any) => c.category === 'barbers');
    expect(barbers.popularServices).toEqual([{ name: 'Haircut', fromPrice: 15 }]);
    expect(Object.keys(barbers).sort()).toEqual(
      ['category', 'fromPrice', 'nextFree', 'places', 'popularServices'].sort(),
    );
    const empty = res.body!.categories.find((c: any) => c.category === 'physiotherapy');
    expect(empty).toEqual({
      category: 'physiotherapy',
      places: 0,
      fromPrice: null,
      nextFree: null,
      popularServices: [],
    });
  });

  it('the raw JSON has no booking count, demand number or client data', async () => {
    const a = await makeBusiness(pg, { name: 'A', services: [svc('Haircut', 15)] });
    await bookings(a, 0, 7);
    const res = await call(categories, '/api/public/categories');
    const raw = JSON.stringify(res.body);
    for (const word of [
      'booking',
      'demand',
      'count',
      'appointment',
      'Fixture Client',
      '+9617',
      '@',
    ])
      expect(raw.toLowerCase()).not.toContain(word.toLowerCase());
    expect(raw).not.toMatch(/"(bookings|demand|count)"/);
    // The only numbers in the popular entry are the price.
    const popularEntry = res.body!.categories.find((c: any) => c.category === 'barbers')
      .popularServices[0];
    expect(Object.values(popularEntry).filter((v) => typeof v === 'number')).toEqual([15]);
  });
});
