/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { GET as directory } from '@/app/api/public/directory/route';
import { availabilityService } from '@/server/services/availability';
import { publicBusinessRepo } from '@/server/repositories/publicBusiness.repo';
import { availabilityRepo } from '@/server/repositories/availability.repo';
import { call } from './helpers/api';
import { countStatements } from './helpers/queryCount';
import { newClient, setupSchema, truncateAll } from './helpers/db';
import { hoursFor, makeBusiness, privateKeysIn } from './helpers/directory';

// PR-10 part E: `sort=soonest` (+ `spread=category`). Time is frozen: Monday 2 Nov 2026, 10:00 in Beirut (UTC+2),
// so with the default 60 min notice and 30 min step the earliest possible start is 11:00 local = 09:00Z.
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
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const soonest = (query: Record<string, string> = {}) =>
  call(directory, '/api/public/directory', {
    query: { include: 'nextFree', sort: 'soonest', ...query },
  });
const names = (r: any) => r.body.businesses.map((b: any) => b.name);
const starts = (r: any) => r.body.businesses.map((b: any) => b.nextFree.startAt);
/** A business whose first free start is `start` local (hours begin then), on a Monday after 11:00 notice. */
const opensAt = (start: string) => ({ hours: hoursFor(start, '20:00') });

describe('sort=soonest: ranking', () => {
  it('orders ACROSS categories by the exact next-free instant (not by name)', async () => {
    await makeBusiness(pg, { name: 'Zeta Barber', category: 'barbers', staff: [opensAt('09:00')] });
    await makeBusiness(pg, {
      name: 'Alpha Spa',
      category: 'spa-massage',
      staff: [opensAt('12:00')],
    });
    await makeBusiness(pg, {
      name: 'Mid Salon',
      category: 'hair-salons',
      staff: [opensAt('11:30')],
    });
    await makeBusiness(pg, {
      name: 'Late Dental',
      category: 'dental-clinics',
      staff: [opensAt('15:00')],
    });
    const res = await soonest();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=300',
    );
    expect(names(res)).toEqual(['Zeta Barber', 'Mid Salon', 'Alpha Spa', 'Late Dental']);
    expect(starts(res)).toEqual([
      '2026-11-02T09:00:00.000Z',
      '2026-11-02T09:30:00.000Z',
      '2026-11-02T10:00:00.000Z',
      '2026-11-02T13:00:00.000Z',
    ]);
    // Items keep the existing live shape; no cursor for this mode.
    const first = res.body!.businesses[0];
    expect(Object.keys(first).sort()).toEqual(
      [
        'address',
        'area',
        'category',
        'freeTimes',
        'fromPrice',
        'logoUrl',
        'name',
        'nextFree',
        'serviceCount',
        'slug',
        'timezone',
      ].sort(),
    );
    expect(first.timezone).toBe('Asia/Beirut');
    expect(first.freeTimes).toHaveLength(4);
    expect('nextCursor' in res.body!).toBe(false);
  });

  it('default limit is 4; limit 1..12 is honoured; 13 and 0 are rejected', async () => {
    for (let i = 0; i < 14; i++)
      await makeBusiness(pg, { name: `B${String(i).padStart(2, '0')}`, staff: [opensAt('09:00')] });
    expect((await soonest()).body!.businesses).toHaveLength(4);
    expect((await soonest({ limit: '1' })).body!.businesses).toHaveLength(1);
    expect((await soonest({ limit: '12' })).body!.businesses).toHaveLength(12);
    for (const limit of ['13', '0', '-1', 'x']) {
      const res = await soonest({ limit });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body!.error.fields)).toContain('limit');
    }
  });

  it('drops businesses with nothing free; unlisted and not-ready ones never appear', async () => {
    await makeBusiness(pg, { name: 'Open', staff: [opensAt('13:00')] });
    await makeBusiness(pg, {
      name: 'Booked out',
      staff: [{ timeOff: [{ startAt: '2026-11-01T00:00:00Z', endAt: '2026-12-30T00:00:00Z' }] }],
    });
    await makeBusiness(pg, { name: 'Hidden', listed: false, staff: [opensAt('09:00')] });
    await makeBusiness(pg, { name: 'Not ready', staff: [{ hours: [] }] });
    const res = await soonest();
    expect(names(res)).toEqual(['Open']);
  });

  it('filters still apply: area, category, search, service', async () => {
    await makeBusiness(pg, {
      name: 'Beirut Barber',
      area: 'beirut',
      category: 'barbers',
      staff: [opensAt('14:00')],
    });
    await makeBusiness(pg, {
      name: 'Sidon Barber',
      area: 'sidon',
      category: 'barbers',
      staff: [opensAt('12:00')],
    });
    await makeBusiness(pg, {
      name: 'Sidon Spa',
      area: 'sidon',
      category: 'spa-massage',
      services: [{ name: 'Massage', durationMin: 60, price: 40 }],
      staff: [opensAt('13:00')],
    });
    expect(names(await soonest({ area: 'sidon' }))).toEqual(['Sidon Barber', 'Sidon Spa']);
    expect(names(await soonest({ area: 'sidon', category: 'spa-massage' }))).toEqual(['Sidon Spa']);
    expect(names(await soonest({ category: 'barbers' }))).toEqual([
      'Sidon Barber',
      'Beirut Barber',
    ]);
    expect(names(await soonest({ search: 'beirut' }))).toEqual(['Beirut Barber']);
    expect(names(await soonest({ service: 'massage' }))).toEqual(['Sidon Spa']);
  });

  it('combines with when: the day filter applies and nextFree describes that day', async () => {
    // Wednesday 4 Nov 2026: 09:00 local = 07:00Z.
    await makeBusiness(pg, {
      name: 'Wed early',
      staff: [{ hours: hoursFor('09:00', '12:00', [3]) }],
    });
    await makeBusiness(pg, {
      name: 'Wed late',
      staff: [{ hours: hoursFor('13:00', '17:00', [3]) }],
    });
    await makeBusiness(pg, {
      name: 'Mon only',
      staff: [{ hours: hoursFor('09:00', '17:00', [1]) }],
    });
    const res = await soonest({ when: '2026-11-04' });
    expect(names(res)).toEqual(['Wed early', 'Wed late']);
    expect(starts(res)).toEqual(['2026-11-04T07:00:00.000Z', '2026-11-04T11:00:00.000Z']);
  });

  it('spread=category: the soonest of each category first, then the next of each', async () => {
    await makeBusiness(pg, { name: 'Barber 1', category: 'barbers', staff: [opensAt('11:00')] });
    await makeBusiness(pg, { name: 'Barber 2', category: 'barbers', staff: [opensAt('11:30')] });
    await makeBusiness(pg, { name: 'Barber 3', category: 'barbers', staff: [opensAt('12:00')] });
    await makeBusiness(pg, { name: 'Spa 1', category: 'spa-massage', staff: [opensAt('14:00')] });
    await makeBusiness(pg, {
      name: 'Dental 1',
      category: 'dental-clinics',
      staff: [opensAt('16:00')],
    });
    expect(names(await soonest({ limit: '5' }))).toEqual([
      'Barber 1',
      'Barber 2',
      'Barber 3',
      'Spa 1',
      'Dental 1',
    ]);
    const spread = await soonest({ limit: '5', spread: 'category' });
    expect(spread.status).toBe(200);
    expect(names(spread)).toEqual(['Barber 1', 'Spa 1', 'Dental 1', 'Barber 2', 'Barber 3']);
    expect(names(await soonest({ limit: '3', spread: 'category' }))).toEqual([
      'Barber 1',
      'Spa 1',
      'Dental 1',
    ]);
    expect('nextCursor' in spread.body!).toBe(false);
  });

  it('equal instants are ordered by name then id (deterministic)', async () => {
    await makeBusiness(pg, { name: 'Same', slug: 'same-b', staff: [opensAt('12:00')] });
    await makeBusiness(pg, { name: 'Same', slug: 'same-a', staff: [opensAt('12:00')] });
    await makeBusiness(pg, { name: 'Aaa', staff: [opensAt('12:00')] });
    const first = await soonest();
    expect(names(first)).toEqual(['Aaa', 'Same', 'Same']);
    // biz-N ids: the earlier-created "Same" has the smaller id.
    expect(first.body!.businesses.map((b: any) => b.slug)).toEqual([
      expect.any(String),
      'same-b',
      'same-a',
    ]);
    expect(JSON.stringify((await soonest()).body)).toBe(JSON.stringify(first.body));
  });

  it('is DST-aware and compares real instants across zones (Asia/Beirut after the Oct 25 change, New York)', async () => {
    vi.setSystemTime(new Date('2026-10-22T10:00:00Z')); // Thursday
    await makeBusiness(pg, {
      name: 'Sunday 9',
      staff: [{ hours: hoursFor('09:00', '10:00', [0]) }],
    });
    await makeBusiness(pg, {
      name: 'Sunday 8',
      staff: [{ hours: hoursFor('08:00', '10:00', [0]) }],
    });
    const res = await soonest();
    // 25 Oct 2026 is UTC+2 in Beirut: 08:00 local = 06:00Z, 09:00 local = 07:00Z (a +3 mistake gives 05:00Z/06:00Z).
    expect(names(res)).toEqual(['Sunday 8', 'Sunday 9']);
    expect(starts(res)).toEqual(['2026-10-25T06:00:00.000Z', '2026-10-25T07:00:00.000Z']);
  });

  it('ranks by instant across time zones, not by the local clock', async () => {
    // Mon 2 Nov 08:00Z = 03:00 EST in New York (DST ended 1 Nov). 05:00 EST = 10:00Z; Beirut 12:30 = 10:30Z.
    await makeBusiness(pg, {
      name: 'New York',
      timezone: 'America/New_York',
      staff: [opensAt('05:00')],
    });
    await makeBusiness(pg, { name: 'Beirut', staff: [opensAt('12:30')] });
    const res = await soonest();
    expect(names(res)).toEqual(['New York', 'Beirut']);
    expect(starts(res)).toEqual(['2026-11-02T10:00:00.000Z', '2026-11-02T10:30:00.000Z']);
  });

  it('respects minNotice: the answer equals the first slot of the booking page', async () => {
    const b = await makeBusiness(pg, {
      name: 'Notice',
      minNoticeMin: 240,
      staff: [opensAt('09:00')],
    });
    const res = await soonest();
    const item = res.body!.businesses[0];
    expect(item.nextFree.startAt).toBe('2026-11-02T12:00:00.000Z'); // 10:00 + 4 h = 14:00 local
    const business = (await publicBusinessRepo.findBySlug(b.slug))!;
    const slots = await availabilityService.slots(
      business,
      { serviceId: b.serviceIds[0]!, from: '2026-11-02', to: '2026-11-02' },
      new Date(),
    );
    expect(slots[0]!.startAt).toBe(item.nextFree.startAt);
  });

  it('include=services adds the services block and keeps the order', async () => {
    await makeBusiness(pg, { name: 'Zed', staff: [opensAt('11:00')] });
    await makeBusiness(pg, { name: 'Abe', staff: [opensAt('13:00')] });
    const res = await soonest({ include: 'nextFree,services' });
    expect(names(res)).toEqual(['Zed', 'Abe']);
    expect(res.body!.businesses[0].services).toEqual([
      { name: 'Haircut', durationMin: 30, price: 15 },
    ]);
  });

  it('a day outside every booking window answers an empty list with no slot query', async () => {
    await makeBusiness(pg, { name: 'Any' });
    const spy = vi.spyOn(availabilityRepo, 'loadMany');
    const res = await soonest({ when: '2027-06-01' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ businesses: [] });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('sort=soonest: the candidate bound', () => {
  it('evaluates at most 24 businesses: the first 24 by name, id (the soonest AMONG them)', async () => {
    // B00..B29. The last six open much earlier, but they are beyond the 24 candidates.
    for (let i = 0; i < 30; i++)
      await makeBusiness(pg, {
        name: `B${String(i).padStart(2, '0')}`,
        staff: [opensAt(i >= 24 ? '11:00' : '14:00')],
      });
    const spy = vi.spyOn(availabilityRepo, 'loadMany');
    const res = await soonest({ limit: '12' });
    expect(res.status).toBe(200);
    const evaluated = spy.mock.calls.flatMap((c) => c[0] as string[]);
    expect(evaluated).toHaveLength(24);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(names(res)).toEqual(
      Array.from({ length: 12 }, (_, i) => `B${String(i).padStart(2, '0')}`),
    );
    for (const n of names(res)) expect(Number(n.slice(1))).toBeLessThan(24);
  });
});

describe('sort=soonest: validation (400)', () => {
  it.each([
    [{ include: 'nextFree', sort: 'latest' }, 'sort'],
    [{ include: 'nextFree', sort: '' }, 'sort'],
    [{ include: 'nextFree', sort: 'SOONEST' }, 'sort'],
    [{ sort: 'soonest' }, 'include'],
    [{ sort: 'soonest', include: 'services' }, 'include'],
    [{ spread: 'category' }, 'spread'],
    [{ include: 'nextFree', spread: 'category' }, 'spread'],
    [{ include: 'nextFree', sort: 'soonest', spread: 'area' }, 'spread'],
    [{ include: 'nextFree', sort: 'soonest', cursor: 'abc' }, 'cursor'],
    [{ include: 'nextFree', sort: 'soonest', bogus: '1' }, 'bogus'],
  ])('%j -> 400 on %s', async (query, field) => {
    const res = await call(directory, '/api/public/directory', {
      query: query as Record<string, string>,
    });
    expect(res.status).toBe(400);
    expect(res.body!.error.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(res.body!.error.fields)).toContain(field);
    expect(res.body!.error.fields[field]).toMatch(/\w/);
  });

  it('the default (no sort) is unchanged: name order, with a cursor', async () => {
    await makeBusiness(pg, { name: 'Zeta', staff: [opensAt('11:00')] });
    await makeBusiness(pg, { name: 'Alpha', staff: [opensAt('15:00')] });
    const res = await call(directory, '/api/public/directory', { query: { include: 'nextFree' } });
    expect(names(res)).toEqual(['Alpha', 'Zeta']);
    expect('nextCursor' in res.body!).toBe(true);
  });
});

describe('sort=soonest: privacy and performance', () => {
  it('raw JSON has no e-mail, phone, staff name or id, or client data', async () => {
    await makeBusiness(pg, {
      name: 'Studio',
      staff: [
        {
          name: 'Rana Hidden Staff',
          bookings: [{ startAt: '2026-11-02T09:00:00Z', endAt: '2026-11-02T09:30:00Z' }],
        },
      ],
    });
    const variants: Record<string, string>[] = [
      {},
      { spread: 'category' },
      { include: 'nextFree,services' },
    ];
    for (const q of variants) {
      const res = await soonest(q);
      const raw = JSON.stringify(res.body);
      expect(res.body!.businesses).toHaveLength(1);
      expect(raw).not.toContain('@');
      expect(raw).not.toMatch(/\+?\d{8,}/);
      expect(raw).not.toContain('Rana Hidden Staff');
      expect(raw).not.toContain('Private Person');
      expect(raw).not.toContain('staff-0');
      expect(privateKeysIn(res.body)).toEqual([]);
    }
  });

  it('60 businesses: answers in well under 1.5 s with a fixed number of queries (numbers reported)', async () => {
    const cats = [
      'barbers',
      'hair-salons',
      'spa-massage',
      'dental-clinics',
      'physiotherapy',
      'other',
    ];
    for (let i = 0; i < 60; i++)
      await makeBusiness(pg, {
        name: `Perf ${String(i).padStart(2, '0')}`,
        category: cats[i % cats.length],
        staff: [opensAt(`${11 + (i % 7)}:00`), opensAt('15:00')],
        services: [
          { name: 'Haircut', durationMin: 30, price: 15 },
          { name: 'Colour', durationMin: 60, price: 40 },
        ],
      });
    const t0 = performance.now();
    const { result: res, statements } = await countStatements(() =>
      soonest({ limit: '12', spread: 'category' }),
    );
    const ms = Math.round(performance.now() - t0);
    expect(res.status).toBe(200);
    expect(res.body!.businesses).toHaveLength(12);
    process.stderr.write(
      `[perf] sort=soonest, 60 businesses (24 evaluated): ${ms} ms, SQL statements: ${statements.length}
`,
    );
    expect(ms).toBeLessThan(1500);
  });
});
