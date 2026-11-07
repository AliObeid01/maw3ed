import { describe, expect, it } from 'vitest';
import {
  FREE_TIMES_MAX,
  NEXT_FREE_DAYS,
  computeNextFree,
  earliestNextFree,
  localWindow,
  mapLimit,
  pickShortestService,
  type DirBusiness,
  type DirService,
  type DirStaff,
} from '@/server/domain/nextFree';

const business: DirBusiness = {
  id: 'b1',
  timezone: 'Asia/Beirut',
  slotStepMin: 30,
  bookingWindowDays: 30,
  minNoticeMin: 60,
};
const cut: DirService = { id: 's-cut', name: 'Haircut', durationMin: 30, bufferMin: 0, price: 15 };
const colour: DirService = {
  id: 's-col',
  name: 'Colour',
  durationMin: 90,
  bufferMin: 0,
  price: 60,
};
const everyDay = (start: string, end: string) =>
  ([0, 1, 2, 3, 4, 5, 6] as const).map((weekday) => ({
    weekday,
    startLocal: start,
    endLocal: end,
  }));
const staff = (over: Partial<DirStaff> = {}): DirStaff => ({
  id: 'st1',
  serviceIds: ['s-cut', 's-col'],
  weeklyHours: everyDay('09:00', '17:00'),
  timeOff: [],
  busy: [],
  ...over,
});
// Monday 2 Nov 2026, 10:00 in Beirut (UTC+2)
const NOW = new Date('2026-11-02T08:00:00Z');

describe('pickShortestService', () => {
  it('takes the shortest active service that somebody can perform', () => {
    expect(pickShortestService([colour, cut], [staff()])?.id).toBe('s-cut');
  });
  it('skips a short service nobody performs', () => {
    expect(pickShortestService([colour, cut], [staff({ serviceIds: ['s-col'] })])?.id).toBe(
      's-col',
    );
  });
  it('ignores staff with no working hours', () => {
    expect(pickShortestService([cut], [staff({ weeklyHours: [] })])).toBeNull();
  });
  it('breaks ties by price, then name, then id (stable)', () => {
    const a: DirService = { ...cut, id: 'b', name: 'B', price: 10 };
    const b: DirService = { ...cut, id: 'a', name: 'A', price: 20 };
    const c: DirService = { ...cut, id: 'c', name: 'A', price: 10 };
    const s = staff({ serviceIds: ['a', 'b', 'c'] });
    expect(pickShortestService([a, b, c], [s])?.id).toBe('c');
    expect(pickShortestService([c, b, a], [s])?.id).toBe('c');
  });
  it('is null with no services or no staff', () => {
    expect(pickShortestService([], [staff()])).toBeNull();
    expect(pickShortestService([cut], [])).toBeNull();
  });
});

describe('localWindow', () => {
  it('is 7 inclusive local days starting at the local today', () => {
    expect(NEXT_FREE_DAYS).toBe(7);
    // 2026-11-02T22:30Z is already Tuesday 3 Nov, 00:30 in Beirut.
    expect(localWindow(new Date('2026-11-02T22:30:00Z'), 'Asia/Beirut')).toEqual({
      from: '2026-11-03',
      to: '2026-11-09',
    });
  });
});

describe('computeNextFree', () => {
  it('earliest start honours the minimum notice and lists up to 4 times on that day', () => {
    const r = computeNextFree(business, [cut, colour], [staff()], NOW)!;
    expect(r.service).toEqual({ id: 's-cut', name: 'Haircut', durationMin: 30 });
    // now 10:00 + 60 min notice => 11:00 local = 09:00Z
    expect(r.startAt.toISOString()).toBe('2026-11-02T09:00:00.000Z');
    expect(FREE_TIMES_MAX).toBe(4);
    expect(r.freeTimes.map((d) => d.toISOString())).toEqual([
      '2026-11-02T09:00:00.000Z',
      '2026-11-02T09:30:00.000Z',
      '2026-11-02T10:00:00.000Z',
      '2026-11-02T10:30:00.000Z',
    ]);
  });

  it('merges staff: one entry per start time', () => {
    const r = computeNextFree(business, [cut], [staff({ id: 'a' }), staff({ id: 'b' })], NOW)!;
    expect(new Set(r.freeTimes.map(Number)).size).toBe(r.freeTimes.length);
  });

  it('skips a closed day and time off, and a fully booked day', () => {
    // Only Wednesday (3) is open. Monday is Nov 2, so Wednesday is Nov 4.
    const onlyWed = staff({
      weeklyHours: [{ weekday: 3, startLocal: '09:00', endLocal: '12:00' }],
    });
    expect(computeNextFree(business, [cut], [onlyWed], NOW)!.startAt.toISOString()).toBe(
      '2026-11-04T07:00:00.000Z',
    );
    // Time off covering the whole of Wednesday pushes it a week out (outside the 7-day window => null).
    const off = {
      ...onlyWed,
      timeOff: [
        { startAt: new Date('2026-11-03T22:00:00Z'), endAt: new Date('2026-11-04T22:00:00Z') },
      ],
    };
    expect(computeNextFree(business, [cut], [off], NOW)).toBeNull();
    // Fully booked Monday: first free is Tuesday 09:00 local.
    const booked = staff({
      busy: [
        {
          startAt: new Date('2026-11-02T07:00:00Z'),
          blockedUntil: new Date('2026-11-02T15:00:00Z'),
        },
      ],
    });
    const r = computeNextFree(business, [cut], [booked], NOW)!;
    expect(r.startAt.toISOString()).toBe('2026-11-03T07:00:00.000Z');
    expect(r.freeTimes.every((d) => d.toISOString().startsWith('2026-11-03'))).toBe(true);
  });

  it('is DST-correct in Asia/Beirut: Sunday 25 Oct 2026 09:00 is 07:00Z (UTC+2), not 06:00Z (+3)', () => {
    const sunday = staff({ weeklyHours: [{ weekday: 0, startLocal: '09:00', endLocal: '10:00' }] });
    const r = computeNextFree(business, [cut], [sunday], new Date('2026-10-22T10:00:00Z'))!;
    expect(r.startAt.toISOString()).toBe('2026-10-25T07:00:00.000Z');
  });

  it('returns null with no services, no staff for the service, or nobody with hours', () => {
    expect(computeNextFree(business, [], [staff()], NOW)).toBeNull();
    expect(computeNextFree(business, [cut], [staff({ serviceIds: [] })], NOW)).toBeNull();
    expect(computeNextFree(business, [cut], [staff({ weeklyHours: [] })], NOW)).toBeNull();
  });

  it('respects the booking window', () => {
    expect(
      computeNextFree({ ...business, bookingWindowDays: 0 }, [cut], [staff()], NOW),
    ).toBeNull();
  });

  it('a window override looks at one local day only (the `when` filter)', () => {
    const r = computeNextFree(business, [cut], [staff()], NOW, {
      from: '2026-11-05',
      to: '2026-11-05',
    })!;
    expect(r.startAt.toISOString()).toBe('2026-11-05T07:00:00.000Z');
    expect(r.freeTimes.every((d) => d.toISOString().startsWith('2026-11-05'))).toBe(true);
    // yesterday has nothing
    expect(
      computeNextFree(business, [cut], [staff()], NOW, { from: '2026-11-01', to: '2026-11-01' }),
    ).toBeNull();
  });
});

describe('earliestNextFree', () => {
  const at = (iso: string, id: string) => ({ startAt: new Date(iso), id });
  it('picks the earliest instant across businesses (timezones compare as instants)', () => {
    const r = earliestNextFree([
      { slug: 'a', nextFree: at('2026-11-03T09:00:00Z', 'x') },
      { slug: 'b', nextFree: null },
      { slug: 'c', nextFree: at('2026-11-02T20:00:00Z', 'y') },
    ]);
    expect(r?.slug).toBe('c');
  });
  it('is null when nobody has one; ties keep the first (stable)', () => {
    expect(earliestNextFree([{ slug: 'a', nextFree: null }])).toBeNull();
    const t = '2026-11-03T09:00:00Z';
    expect(
      earliestNextFree([
        { slug: 'a', nextFree: at(t, '1') },
        { slug: 'b', nextFree: at(t, '2') },
      ])?.slug,
    ).toBe('a');
  });
});

describe('mapLimit', () => {
  it('keeps the input order and never runs more than `limit` at once', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3, 9, 0, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n));
      running--;
      return n * 2;
    });
    expect(out).toEqual([10, 2, 8, 4, 6, 18, 0, 14]);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });
  it('rejects when a worker rejects and handles an empty list', async () => {
    await expect(
      mapLimit([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
    expect(await mapLimit([], 4, async (n: number) => n)).toEqual([]);
  });
});
