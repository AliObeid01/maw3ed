/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { GET as categories } from '@/app/api/public/categories/route';
import { GET as directory } from '@/app/api/public/directory/route';
import { CATEGORY_KEYS } from '@/lib/business/profile';
import { availabilityRepo } from '@/server/repositories/availability.repo';
import { call } from './helpers/api';
import { newClient, setupSchema, truncateAll } from './helpers/db';
import { hoursFor, makeBusiness } from './helpers/directory';

// PR-6 part B: live aggregates for the marketplace home / explore pages. Time is frozen: Monday 2 Nov 2026,
// 10:00 in Beirut (UTC+2).
const NOW = new Date('2026-11-02T08:00:00Z');

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

const live = (query: Record<string, string> = {}) =>
  call(directory, '/api/public/directory', { query: { include: 'nextFree', ...query } });
const plain = (query: Record<string, string> = {}) =>
  call(directory, '/api/public/directory', { query });
const cats = (query: Record<string, string> = {}) =>
  call(categories, '/api/public/categories', { query });
const bySlug = (r: any, slug: string) => r.body.businesses.find((b: any) => b.slug === slug);

describe('directory?include=nextFree: the definition of "next free"', () => {
  it('shortest active service, min notice applied, up to 4 times on the first day, instants in UTC', async () => {
    const b = await makeBusiness(pg, {
      name: 'Alpha',
      services: [
        { name: 'Colour', durationMin: 90, price: 60 },
        { name: 'Haircut', durationMin: 30, price: 15 },
        { name: 'Quick trim', durationMin: 15, price: 5, active: false }, // inactive: never the shortest
      ],
    });
    const res = await live();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=300',
    );
    const item = bySlug(res, b.slug);
    expect(item.timezone).toBe('Asia/Beirut');
    expect(item.nextFree).toEqual({
      startAt: '2026-11-02T09:00:00.000Z', // 10:00 + 60 min notice = 11:00 Beirut
      service: { id: b.serviceIds[1], name: 'Haircut', durationMin: 30 },
    });
    expect(item.freeTimes).toEqual([
      '2026-11-02T09:00:00.000Z',
      '2026-11-02T09:30:00.000Z',
      '2026-11-02T10:00:00.000Z',
      '2026-11-02T10:30:00.000Z',
    ]);
  });

  it('closed days, time off and a fully booked day push it to the right later day', async () => {
    const closed = await makeBusiness(pg, {
      name: 'Closed Mon',
      staff: [{ hours: hoursFor('09:00', '12:00', [3]) }], // Wednesday only
    });
    const off = await makeBusiness(pg, {
      name: 'Time off',
      staff: [{ timeOff: [{ startAt: '2026-11-02T00:00:00Z', endAt: '2026-11-03T22:00:00Z' }] }],
    });
    const full = await makeBusiness(pg, {
      name: 'Full Monday',
      staff: [{ bookings: [{ startAt: '2026-11-02T07:00:00Z', endAt: '2026-11-02T15:00:00Z' }] }],
    });
    const res = await live();
    expect(bySlug(res, closed.slug).nextFree.startAt).toBe('2026-11-04T07:00:00.000Z');
    // Time off covers Mon and Tue (to 00:00 Wed Beirut = Tue 22:00Z): first free is Wednesday 09:00 local.
    expect(bySlug(res, off.slug).nextFree.startAt).toBe('2026-11-04T07:00:00.000Z');
    expect(bySlug(res, full.slug).nextFree.startAt).toBe('2026-11-03T07:00:00.000Z');
    expect(bySlug(res, full.slug).freeTimes.every((t: string) => t.startsWith('2026-11-03'))).toBe(
      true,
    );
  });

  it('a cancelled booking does not block', async () => {
    const b = await makeBusiness(pg, {
      name: 'Hold',
      staff: [
        {
          bookings: [
            { startAt: '2026-11-02T09:00:00Z', endAt: '2026-11-02T09:30:00Z', status: 'CANCELLED' },
          ],
        },
      ],
    });
    const res = await live();
    expect(bySlug(res, b.slug).freeTimes[0]).toBe('2026-11-02T09:00:00.000Z');
  });

  it('is DST-correct in Asia/Beirut (clocks went back on Sunday 25 Oct 2026)', async () => {
    vi.setSystemTime(new Date('2026-10-22T10:00:00Z'));
    const b = await makeBusiness(pg, {
      name: 'Sundays',
      staff: [{ hours: hoursFor('09:00', '10:00', [0]) }],
    });
    const res = await live();
    // 09:00 local on 25 Oct is UTC+2 => 07:00Z (a +3 mistake would give 06:00Z).
    expect(bySlug(res, b.slug).nextFree.startAt).toBe('2026-10-25T07:00:00.000Z');
  });

  it('uses the business own timezone (a New York business on the same instant)', async () => {
    const b = await makeBusiness(pg, {
      name: 'New York',
      timezone: 'America/New_York',
      area: 'other',
    });
    const item = bySlug(await live(), b.slug);
    expect(item.timezone).toBe('America/New_York');
    // 08:00Z = 03:00 EST; notice 60 min; hours open 09:00 local => 14:00Z the same local day.
    expect(item.nextFree.startAt).toBe('2026-11-02T14:00:00.000Z');
  });

  it('null when ready but nobody performs any service, or nothing is free in 7 days', async () => {
    const noOne = await makeBusiness(pg, { name: 'Nobody does it', staff: [{ serviceIdx: [] }] });
    const shut = await makeBusiness(pg, {
      name: 'Shut',
      staff: [{ timeOff: [{ startAt: '2026-11-01T00:00:00Z', endAt: '2026-11-20T00:00:00Z' }] }],
    });
    const res = await live();
    for (const slug of [noOne.slug, shut.slug]) {
      expect(bySlug(res, slug).nextFree).toBeNull();
      expect(bySlug(res, slug).freeTimes).toEqual([]);
    }
  });

  it('without include the items keep exactly the old keys', async () => {
    const b = await makeBusiness(pg, { name: 'Plain' });
    const item = bySlug(await plain(), b.slug);
    expect(Object.keys(item).sort()).toEqual(
      ['address', 'area', 'category', 'fromPrice', 'name', 'serviceCount', 'slug'].sort(),
    );
  });

  it('unlisted and not-ready businesses never appear; order stays the directory order under bounded concurrency', async () => {
    await makeBusiness(pg, { name: 'Hidden', listed: false });
    await makeBusiness(pg, { name: 'No hours', staff: [{ hours: [] }] });
    await makeBusiness(pg, { name: 'No bookable staff', staff: [{ bookable: false }] });
    const names = Array.from({ length: 12 }, (_, i) => `Shop ${String.fromCharCode(65 + i)}`);
    for (const name of [...names].reverse()) await makeBusiness(pg, { name });
    const res = await live();
    expect(res.body!.businesses.map((x: any) => x.name)).toEqual(names);
    expect(res.body!.businesses.every((x: any) => x.nextFree !== null)).toBe(true);
    expect(res.body!.nextCursor).toBeNull();
  });
});

describe('directory filters', () => {
  it('service: contains, case-insensitive, active services only, wildcards are literal', async () => {
    const a = await makeBusiness(pg, {
      name: 'A',
      services: [{ name: 'Beard trim', durationMin: 20, price: 8 }],
    });
    await makeBusiness(pg, {
      name: 'B',
      services: [{ name: 'Haircut', durationMin: 30, price: 15 }],
    });
    await makeBusiness(pg, {
      name: 'C',
      services: [
        { name: 'Haircut', durationMin: 30, price: 15 },
        { name: 'Beard oil', durationMin: 10, price: 3, active: false },
      ],
    });
    const hit = await plain({ service: 'BEARD' });
    expect(hit.body!.businesses.map((x: any) => x.slug)).toEqual([a.slug]);
    expect((await plain({ service: '%' })).body!.businesses).toEqual([]);
    expect((await plain({ service: 'x\'; DROP TABLE "Business"; --' })).body!.businesses).toEqual(
      [],
    );
    expect((await plain()).body!.businesses).toHaveLength(3); // table still there
  });

  it('combines with search, area and category', async () => {
    await makeBusiness(pg, { name: 'Nour Cuts', category: 'barbers', area: 'beirut' });
    await makeBusiness(pg, { name: 'Nour Hair', category: 'hair-salons', area: 'beirut' });
    await makeBusiness(pg, { name: 'Nour Sidon', category: 'barbers', area: 'sidon' });
    const r = await plain({ search: 'nour', category: 'barbers', area: 'beirut', service: 'hair' });
    expect(r.body!.businesses.map((x: any) => x.name)).toEqual(['Nour Cuts']);
  });

  it('when: only businesses with a free slot that local day, with that day times', async () => {
    const openWed = await makeBusiness(pg, {
      name: 'Open Wed',
      staff: [{ hours: hoursFor('09:00', '17:00', [3]) }],
    });
    await makeBusiness(pg, {
      name: 'Closed Wed',
      staff: [{ hours: hoursFor('09:00', '17:00', [1]) }],
    });
    const booked = await makeBusiness(pg, {
      name: 'Booked Wed',
      staff: [{ bookings: [{ startAt: '2026-11-04T07:00:00Z', endAt: '2026-11-04T15:00:00Z' }] }],
    });
    const res = await live({ when: '2026-11-04' });
    expect(res.status).toBe(200);
    const slugs = res.body!.businesses.map((x: any) => x.slug);
    expect(slugs).toContain(openWed.slug);
    expect(slugs).not.toContain(booked.slug);
    expect(res.body!.businesses.map((x: any) => x.name)).not.toContain('Closed Wed');
    const item = bySlug(res, openWed.slug);
    expect(item.freeTimes[0]).toBe('2026-11-04T07:00:00.000Z');
    expect(item.freeTimes.every((t: string) => t.startsWith('2026-11-04'))).toBe(true);
    // Without include the shape is the plain one even with when.
    const bare = await plain({ when: '2026-11-04' });
    expect(Object.keys(bare.body!.businesses[0]).sort()).toEqual(
      ['address', 'area', 'category', 'fromPrice', 'name', 'serviceCount', 'slug'].sort(),
    );
  });

  it('when: a past day and a day beyond the booking window match nothing', async () => {
    await makeBusiness(pg, { name: 'Window', bookingWindowDays: 10 });
    expect((await plain({ when: '2026-11-01' })).body!.businesses).toEqual([]);
    expect((await plain({ when: '2026-12-25' })).body!.businesses).toEqual([]);
    expect((await plain({ when: '2026-11-05' })).body!.businesses).toHaveLength(1);
  });

  it('when: paginates by a bounded scan; following nextCursor visits every match exactly once', async () => {
    // 50 businesses, only every 5th is open on Wednesday. limit 4 => needs several scans.
    const open: string[] = [];
    for (let i = 0; i < 50; i++) {
      const name = `Biz ${String(i).padStart(2, '0')}`;
      const b = await makeBusiness(pg, {
        name,
        staff: [{ hours: hoursFor('09:00', '17:00', i % 5 === 0 ? [3] : [1]) }],
      });
      if (i % 5 === 0) open.push(b.slug);
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    let requests = 0;
    do {
      const res = await plain({ when: '2026-11-04', limit: '4', ...(cursor ? { cursor } : {}) });
      expect(res.status).toBe(200);
      expect(res.body!.businesses.length).toBeLessThanOrEqual(4);
      seen.push(...res.body!.businesses.map((x: any) => x.slug));
      cursor = res.body!.nextCursor ?? undefined;
      requests++;
    } while (cursor && requests < 40);
    expect(seen).toEqual(open);
    expect(requests).toBeGreaterThan(1);
  });
});

describe('when outside any possible window', () => {
  it('a past day and a day beyond every booking window answer an empty page with NO slot computation', async () => {
    await makeBusiness(pg, { name: 'Window', bookingWindowDays: 10 });
    const spy = vi.spyOn(availabilityRepo, 'loadMany');
    for (const when of ['2026-10-20', '2026-10-31', '2027-06-01', '2100-12-31']) {
      const res = await plain({ when });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ businesses: [], nextCursor: null });
    }
    expect(spy).not.toHaveBeenCalled();
    // today and tomorrow still compute
    expect((await plain({ when: '2026-11-02' })).body!.businesses).toHaveLength(1);
    expect((await plain({ when: '2026-11-03' })).body!.businesses).toHaveLength(1);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('validation (400)', () => {
  it.each([
    [{ when: '2026-02-31' }, 'when'],
    [{ when: 'tomorrow' }, 'when'],
    [{ when: '2026-11-4' }, 'when'],
    [{ when: '9999-12-31' }, 'when'],
    [{ when: '0000-01-01' }, 'when'],
    [{ when: '1999-12-31' }, 'when'],
    [{ when: '2101-01-01' }, 'when'],
    [{ include: 'everything' }, 'include'],
    [{ include: 'nextFree,bogus' }, 'include'],
    [{ include: 'services', limit: '13' }, 'limit'],
    [{ include: 'nextFree', limit: '13' }, 'limit'],
    [{ when: '2026-11-04', limit: '40' }, 'limit'],
    [{ service: 'a\u0000b' }, 'service'],
    [{ service: 'x'.repeat(61) }, 'service'],
    [{ bogus: '1' }, 'bogus'],
  ])('directory %j -> 400 on %s', async (query, field) => {
    const res = await plain(query as Record<string, string>);
    expect(res.status).toBe(400);
    expect(res.body!.error.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(res.body!.error.fields)).toContain(field);
  });

  it.each([
    [{ area: 'mars' }, 'area'],
    [{ bogus: '1' }, 'bogus'],
    [{ include: 'nextFree' }, 'include'],
  ])('categories %j -> 400 on %s', async (query, field) => {
    const res = await cats(query as Record<string, string>);
    expect(res.status).toBe(400);
    expect(Object.keys(res.body!.error.fields)).toContain(field);
  });

  it('accepts empty strings as "not set" like the existing filters', async () => {
    expect((await plain({ when: '', include: '', service: '' })).status).toBe(200);
    expect((await cats({ area: '' })).status).toBe(200);
  });
});

describe('GET /api/public/categories', () => {
  it('returns every fixed key (zero places included) with places, from price, popular services, next free', async () => {
    await makeBusiness(pg, {
      name: 'Barber One',
      category: 'barbers',
      services: [
        { name: 'Haircut', durationMin: 30, price: 15 },
        { name: 'Beard trim', durationMin: 15, price: 6 },
      ],
    });
    await makeBusiness(pg, {
      name: 'Barber Two',
      category: 'barbers',
      services: [
        { name: 'haircut', durationMin: 30, price: 12 },
        { name: 'Shave', durationMin: 20, price: 9 },
      ],
      staff: [{ hours: hoursFor('09:00', '17:00', [3]) }],
    });
    await makeBusiness(pg, {
      name: 'Clinic',
      category: 'dental-clinics',
      services: [{ name: 'Check-up', durationMin: 30, price: 40 }],
    });
    await makeBusiness(pg, {
      name: 'Unlisted barber',
      category: 'barbers',
      listed: false,
      services: [{ name: 'Cheap', durationMin: 5, price: 1 }],
    });
    await makeBusiness(pg, {
      name: 'Not ready barber',
      category: 'barbers',
      staff: [{ hours: [] }],
      services: [{ name: 'Cheap2', durationMin: 5, price: 1 }],
    });

    const res = await cats();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=300',
    );
    const list = res.body!.categories as any[];
    expect(list.map((c) => c.category)).toEqual([...CATEGORY_KEYS]);

    const barbers = list.find((c) => c.category === 'barbers');
    expect(barbers.places).toBe(2);
    expect(barbers.fromPrice).toBe(6);
    expect(barbers.popularServices[0]).toEqual({
      name: expect.stringMatching(/^haircut$/i),
      fromPrice: 12,
    });
    expect(barbers.popularServices.map((s: any) => s.name.toLowerCase()).sort()).toEqual([
      'beard trim',
      'haircut',
      'shave',
    ]);
    expect(barbers.nextFree).toEqual({
      startAt: '2026-11-02T09:00:00.000Z',
      service: { id: expect.any(String), name: 'Beard trim', durationMin: 15 },
      business: { slug: expect.any(String), name: 'Barber One', timezone: 'Asia/Beirut' },
    });
    expect(list.find((c) => c.category === 'dental-clinics').places).toBe(1);
    for (const key of ['hair-salons', 'beauty-clinics', 'spa-massage', 'physiotherapy', 'other']) {
      expect(list.find((c) => c.category === key)).toEqual({
        category: key,
        places: 0,
        fromPrice: null,
        nextFree: null,
        popularServices: [],
      });
    }
  });

  it('area narrows every aggregate; popular services are capped at 5', async () => {
    await makeBusiness(pg, {
      name: 'Beirut barber',
      area: 'beirut',
      services: Array.from({ length: 7 }, (_, i) => ({
        name: `Service ${i}`,
        durationMin: 30 + i,
        price: 10 + i,
      })),
    });
    await makeBusiness(pg, {
      name: 'Sidon barber',
      area: 'sidon',
      services: [{ name: 'Only sidon', durationMin: 30, price: 2 }],
    });
    const sidon = (await cats({ area: 'sidon' })).body!.categories.find(
      (c: any) => c.category === 'barbers',
    );
    expect(sidon.places).toBe(1);
    expect(sidon.fromPrice).toBe(2);
    expect(sidon.popularServices).toEqual([{ name: 'Only sidon', fromPrice: 2 }]);
    const beirut = (await cats({ area: 'beirut' })).body!.categories.find(
      (c: any) => c.category === 'barbers',
    );
    expect(beirut.popularServices).toHaveLength(5);
    const none = (await cats({ area: 'tyre' })).body!.categories.find(
      (c: any) => c.category === 'barbers',
    );
    expect(none.places).toBe(0);
  });

  it('next free is computed for the first 6 businesses of a category only (bounded)', async () => {
    // 8 barbers named A..H. The first 6 are closed every day; G and H are open. So the answer must be null.
    for (const [i, name] of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].entries())
      await makeBusiness(pg, {
        name: `Barber ${name}`,
        staff: [
          {
            timeOff:
              i < 6 ? [{ startAt: '2026-11-01T00:00:00Z', endAt: '2026-11-30T00:00:00Z' }] : [],
          },
        ],
      });
    const barbers = (await cats()).body!.categories.find((c: any) => c.category === 'barbers');
    expect(barbers.places).toBe(8);
    expect(barbers.nextFree).toBeNull();
  });
});

describe('directory?include=services (PR-7b)', () => {
  const both = (query: Record<string, string> = {}) =>
    live({ include: 'nextFree,services', ...query });

  it('adds up to 4 ACTIVE services per business, cheapest first then name; price is a number like fromPrice', async () => {
    const b = await makeBusiness(pg, {
      name: 'Alpha',
      services: [
        { name: 'Zed cut', durationMin: 30, price: 10 },
        { name: 'Alpha cut', durationMin: 30, price: 10 },
        { name: 'Colour', durationMin: 90, price: 60.5 },
        { name: 'Beard', durationMin: 15, price: 5 },
        { name: 'Wash', durationMin: 15, price: 8 },
        { name: 'Hidden', durationMin: 15, price: 1, active: false },
      ],
    });
    const res = await both();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=300',
    );
    const item = bySlug(res, b.slug);
    expect(item.services).toEqual([
      { name: 'Beard', durationMin: 15, price: 5 },
      { name: 'Wash', durationMin: 15, price: 8 },
      { name: 'Alpha cut', durationMin: 30, price: 10 },
      { name: 'Zed cut', durationMin: 30, price: 10 },
    ]);
    expect(typeof item.fromPrice).toBe('number');
    expect(item.nextFree).not.toBeUndefined();
    expect(item.serviceCount).toBe(5);
  });

  it('works alone (no slot fields) and in either order', async () => {
    const b = await makeBusiness(pg, { name: 'Solo' });
    const item = bySlug(await live({ include: 'services' }), b.slug);
    expect(item.services).toHaveLength(1);
    expect(item.nextFree).toBeUndefined();
    expect(item.freeTimes).toBeUndefined();
    const swapped = bySlug(await live({ include: 'services,nextFree' }), b.slug);
    expect(swapped.services).toEqual(item.services);
    expect(swapped.nextFree).not.toBeUndefined();
  });

  it('keeps the directory order and never lists unlisted or not-ready businesses', async () => {
    await makeBusiness(pg, { name: 'Hidden', listed: false });
    await makeBusiness(pg, { name: 'No hours', staff: [{ hours: [] }] });
    await makeBusiness(pg, { name: 'B shop' });
    await makeBusiness(pg, { name: 'A shop' });
    const res = await both();
    expect(res.body!.businesses.map((x: any) => x.name)).toEqual(['A shop', 'B shop']);
    expect(res.body!.businesses.every((x: any) => x.services.length === 1)).toBe(true);
  });

  it('combines with when', async () => {
    const b = await makeBusiness(pg, { name: 'Tuesday' });
    const item = bySlug(await both({ when: '2026-11-03' }), b.slug);
    expect(item.services).toHaveLength(1);
    expect(item.freeTimes.length).toBeGreaterThan(0);
  });

  it('the old include=nextFree response is unchanged: no services key', async () => {
    const b = await makeBusiness(pg, { name: 'Old' });
    const item = bySlug(await live(), b.slug);
    expect(Object.keys(item).sort()).toEqual(
      [
        'address',
        'area',
        'category',
        'freeTimes',
        'fromPrice',
        'name',
        'nextFree',
        'serviceCount',
        'slug',
        'timezone',
      ].sort(),
    );
  });

  it('raw JSON has no e-mail, phone, staff name or id', async () => {
    await makeBusiness(pg, { name: 'Private Studio', staff: [{ name: 'Zeina Secretname' }] });
    const raw = JSON.stringify((await both()).body);
    expect(raw).not.toContain('@');
    expect(raw).not.toMatch(/\+?\d{8,}/);
    expect(raw).not.toContain('Zeina');
    expect(raw).not.toMatch(/staff|client|appointment|email|phone/i);
  });
});

describe('privacy', () => {
  it('raw JSON of every new response has no e-mail, no phone, no staff or client names', async () => {
    await makeBusiness(pg, {
      name: 'Private Studio',
      staff: [
        {
          name: 'Zeina Secretname',
          bookings: [{ startAt: '2026-11-02T09:00:00Z', endAt: '2026-11-02T09:30:00Z' }],
        },
      ],
    });
    const raws = [
      JSON.stringify((await live()).body),
      JSON.stringify((await live({ when: '2026-11-03' })).body),
      JSON.stringify((await cats()).body),
    ];
    for (const raw of raws) {
      expect(raw).not.toContain('@');
      expect(raw).not.toMatch(/\+?\d{8,}/); // no phone-like digit runs
      expect(raw).not.toContain('Zeina');
      expect(raw).not.toContain('Secretname');
      expect(raw).not.toContain('Private Person');
      expect(raw).not.toMatch(/staff|client|appointment|email|phone/i);
    }
  });
});
