import { describe, expect, it } from 'vitest';
import {
  generateSlots,
  mergeAnyone,
  pickStaff,
  type GenerateSlotsInput,
  type StaffAvailability,
  type Weekday,
} from '@/server/domain/slots';
import {
  generateSlots as referenceSlots,
  mergeAnyone as referenceMerge,
  pickStaff as referencePick,
  localToUtcMs as referenceLocalToUtc,
} from './slotsReferencePre33';
import { IANAZone } from 'luxon';
import { __slotCachesForTests } from '@/server/domain/slots';

/**
 * F33 proof of equivalence. slotsReferencePre33.ts is a verbatim copy of the domain slot generator as it
 * was before the speed work. The optimised generator must return EXACTLY the same slots in the same order
 * for a wide range of inputs: 1 to 10 staff, split shifts, buffers, time off, minimum notice, the booking
 * window edge, the "anyone" merge, and both Beirut DST transition days (plus other zones).
 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const hm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

const ZONES = [
  'Asia/Beirut',
  'Asia/Beirut',
  'Asia/Beirut',
  'Europe/London',
  'America/New_York',
  'Australia/Lord_Howe',
  'Asia/Kolkata',
  'UTC',
];
/** Zone-specific ranges around real transitions (and far past / far future dates). */
const ZONE_CASES: [string, string, string][] = [
  ['Australia/Lord_Howe', '2026-04-03', '2026-04-06'],
  ['Australia/Lord_Howe', '2026-10-02', '2026-10-05'],
  ['Asia/Beirut', '2027-10-29', '2027-11-01'],
  ['Asia/Beirut', '2027-03-26', '2027-03-29'],
  ['Asia/Kathmandu', '2026-12-30', '2027-01-02'],
  ['Asia/Kathmandu', '1986-01-01', '1986-01-02'],
  ['Pacific/Chatham', '2026-04-03', '2026-04-06'],
  ['Pacific/Chatham', '2026-09-25', '2026-09-28'],
  ['Europe/Dublin', '2026-03-28', '2026-03-30'],
  ['Europe/Dublin', '2026-10-24', '2026-10-26'],
  ['Asia/Beirut', '2001-03-30', '2001-04-02'],
  ['Europe/London', '2001-10-27', '2001-10-29'],
  ['Asia/Beirut', '2035-03-24', '2035-03-27'],
  ['America/New_York', '2035-11-03', '2035-11-05'],
];
const RANGES: [string, string][] = [
  ['2026-03-27', '2026-03-31'], // Beirut spring forward on the 29th
  ['2026-10-23', '2026-10-27'], // Beirut fall back on the 25th
  ['2026-03-29', '2026-03-29'],
  ['2026-10-25', '2026-10-25'],
  ['2026-10-24', '2026-10-25'],
  ['2027-03-27', '2027-03-29'],
  ['2026-03-07', '2026-03-09'], // US spring forward
  ['2026-11-01', '2026-11-14'], // the load-test shape: 14 days
  ['2026-10-31', '2026-11-02'],
  ['2026-12-01', '2026-12-31'],
];

function weekly(r: () => number): StaffAvailability['weeklyHours'] {
  const out: StaffAvailability['weeklyHours'] = [];
  const mode = r();
  for (let wd = 0; wd < 7; wd++) {
    if (mode < 0.15) {
      out.push({ weekday: wd as Weekday, startLocal: '00:00', endLocal: '24:00' });
      continue;
    }
    if (r() < 0.12) continue; // day off
    if (r() < 0.4) {
      // split shift
      const a = int(r, 6 * 60, 10 * 60);
      const b = a + int(r, 2, 4) * 60;
      const c = b + int(r, 1, 2) * 60;
      const d = Math.min(c + int(r, 2, 5) * 60, 24 * 60);
      out.push({ weekday: wd as Weekday, startLocal: hm(a), endLocal: hm(b) });
      if (d > c)
        out.push({
          weekday: wd as Weekday,
          startLocal: hm(c),
          endLocal: d === 1440 ? '24:00' : hm(d),
        });
    } else {
      const a = pick(r, [0, 0, 60, 8 * 60, 8 * 60, 9 * 60, 22 * 60, 23 * 60]);
      const b = pick(r, [a + 120, a + 480, a + 720, 1440, 1440]);
      out.push({
        weekday: wd as Weekday,
        startLocal: hm(a),
        endLocal: b >= 1440 ? '24:00' : hm(b),
      });
    }
  }
  return out;
}

function makeCase(r: () => number): GenerateSlotsInput {
  const zoneCase = r() < 0.5 ? pick(r, ZONE_CASES) : undefined;
  const [from, to] = zoneCase ? [zoneCase[1], zoneCase[2]] : pick(r, RANGES);
  const timezone = zoneCase ? zoneCase[0] : pick(r, ZONES);
  const base = Date.parse(`${from}T00:00:00Z`);
  const spanMs = (Date.parse(`${to}T00:00:00Z`) - base) / 1 + 2 * 86_400_000;
  const staffCount = pick(r, [1, 1, 2, 3, 5, 8, 10, 10]);
  const staff: StaffAvailability[] = Array.from({ length: staffCount }, (_, i) => {
    const busyCount = pick(r, [0, 2, 8, 20, 40, 70]);
    const busy = Array.from({ length: busyCount }, () => {
      const startAt = new Date(base - 86_400_000 + Math.floor(r() * spanMs));
      // a few zero-length / long ones; buffers make blockedUntil > end
      const len = r() < 0.05 ? 0 : int(r, 1, 12) * 15 * 60_000;
      return { startAt, blockedUntil: new Date(startAt.getTime() + len) };
    });
    const timeOff = Array.from({ length: pick(r, [0, 0, 1, 2, 4]) }, () => {
      const startAt = new Date(base + Math.floor(r() * spanMs));
      const len = r() < 0.05 ? -3_600_000 : int(r, 1, 30) * 3_600_000; // inverted ones block nothing
      return { startAt, endAt: new Date(startAt.getTime() + len) };
    });
    const weeklyHours = weekly(r);
    // Cuts placed EXACTLY on working-interval boundaries (start == interval start, end == interval end),
    // touching each other, and straddling a boundary by one step.
    const dayCount = Math.round((Date.parse(`${to}T00:00:00Z`) - base) / 86_400_000) + 1;
    for (let k = 0; k < pick(r, [0, 0, 2, 4, 6]) && weeklyHours.length; k++) {
      const wh = pick(r, weeklyHours);
      const d = new Date(base + int(r, 0, dayCount - 1) * 86_400_000);
      const parts = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
      const [sh, sm] = wh.startLocal.split(':').map(Number) as [number, number];
      const [eh, em] = wh.endLocal.split(':').map(Number) as [number, number];
      const a = referenceLocalToUtc(parts, sh, sm, timezone);
      const b = referenceLocalToUtc(parts, eh, em, timezone);
      const mid = Math.floor((a + b) / 2);
      const pickCut = pick(r, [0, 1, 2, 3, 4]);
      if (pickCut === 0) busy.push({ startAt: new Date(a), blockedUntil: new Date(b) });
      else if (pickCut === 1) {
        busy.push({ startAt: new Date(a), blockedUntil: new Date(mid) });
        timeOff.push({ startAt: new Date(mid), endAt: new Date(b) });
      } else if (pickCut === 2)
        timeOff.push({ startAt: new Date(a - 3_600_000), endAt: new Date(a) });
      else if (pickCut === 3)
        busy.push({ startAt: new Date(b), blockedUntil: new Date(b + 1_800_000) });
      else busy.push({ startAt: new Date(a - 900_000), blockedUntil: new Date(a + 900_000) });
    }
    // ids deliberately not in sorted order, and with a shared prefix, to exercise the id tie-break
    return {
      id: `staff-${String(staffCount - i).padStart(2, '0')}-${i % 3}`,
      weeklyHours,
      timeOff,
      busy,
    };
  });
  const windowDays = pick(r, [3, 7, 10, 30, 60, 365, 365]);
  const nowOffsetMs = int(r, 0, 6) * 86_400_000 + int(r, 0, 1440) * 60_000;
  return {
    service: {
      durationMin: pick(r, [5, 10, 15, 20, 30, 45, 60, 90, 120]),
      bufferMin: pick(r, [0, 0, 5, 15, 30]),
    },
    staff,
    slotStepMin: pick(r, [5, 10, 15, 20, 30, 60]),
    minNoticeMin: pick(r, [0, 0, 60, 120, 1440]),
    bookingWindowDays: windowDays,
    timezone,
    now: new Date(base - nowOffsetMs),
    range: { from, to },
  };
}

describe('F33: generateSlots / mergeAnyone equal the pre-optimisation implementation', () => {
  it(
    'matches on 450 randomised cases (1 to 10 staff), slots and the anyone merge, same order',
    {
      timeout: 170_000,
    },
    () => {
      const r = rng(20261031);
      let nonEmpty = 0;
      let multiCandidate = 0;
      for (let i = 0; i < 450; i++) {
        const input = makeCase(r);
        const got = generateSlots(input);
        const want = referenceSlots(input);
        if (JSON.stringify(got) !== JSON.stringify(want))
          expect.fail(
            `case ${i} slots differ: ${JSON.stringify(input.range)} ${input.timezone} step ${input.slotStepMin} staff ${input.staff.length}`,
          );
        const gotAnyone = mergeAnyone(got);
        const wantAnyone = referenceMerge(want);
        if (JSON.stringify(gotAnyone) !== JSON.stringify(wantAnyone))
          expect.fail(`case ${i} anyone merge differs`);
        if (want.length) nonEmpty++;
        if (wantAnyone.some((s) => s.candidateStaffIds.length > 1)) multiCandidate++;
      }
      expect(nonEmpty).toBeGreaterThan(200);
      expect(multiCandidate).toBeGreaterThan(60);
    },
  );

  it(
    'repeated calls (warm internal caches) stay identical to the reference',
    { timeout: 120_000 },
    () => {
      const r = rng(77);
      const inputs = Array.from({ length: 12 }, () => makeCase(r));
      for (let pass = 0; pass < 2; pass++)
        for (const input of inputs)
          expect(JSON.stringify(generateSlots(input))).toBe(JSON.stringify(referenceSlots(input)));
    },
  );

  it('pins a Beirut DST day with a repeated hour and a skipped hour for every step size', () => {
    for (const range of [
      { from: '2026-03-29', to: '2026-03-29' },
      { from: '2026-10-24', to: '2026-10-25' },
    ]) {
      for (const slotStepMin of [5, 15, 30, 60]) {
        for (const full of [true, false]) {
          const input: GenerateSlotsInput = {
            service: { durationMin: 30, bufferMin: 0 },
            staff: [
              {
                id: 'a',
                weeklyHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
                  weekday: weekday as Weekday,
                  startLocal: full ? '00:00' : '08:00',
                  endLocal: full ? '24:00' : '20:00',
                })),
                timeOff: [],
                busy: [],
              },
            ],
            slotStepMin,
            minNoticeMin: 0,
            bookingWindowDays: 365,
            timezone: 'Asia/Beirut',
            now: new Date('2026-03-01T00:00:00Z'),
            range,
          };
          const got = generateSlots(input);
          expect(got.length).toBeGreaterThan(0);
          expect(JSON.stringify(got)).toBe(JSON.stringify(referenceSlots(input)));
        }
      }
    }
  });

  it('pickStaff is unchanged (least booked that day, ties to the lowest id)', () => {
    const r = rng(5);
    for (let i = 0; i < 300; i++) {
      const ids = Array.from({ length: int(r, 1, 10) }, () => `s${int(r, 0, 20)}`);
      const counts: Record<string, number> = {};
      for (const id of ids) if (r() < 0.7) counts[id] = int(r, 0, 4);
      expect(pickStaff(ids, counts)).toBe(referencePick(ids, counts));
    }
  });
});

describe('F33: memoised zone offsets and bounded caches', () => {
  const FIFTEEN = 15 * 60_000;
  const WEEK = 7 * 86_400_000;

  it(
    'offsetMs equals Luxon IANAZone.offset every 15 minutes around transitions and on ordinary weeks',
    {
      timeout: 60_000,
    },
    () => {
      __slotCachesForTests.clear();
      const windows: [string, string, number][] = [
        ['Asia/Beirut', '2026-03-29', 2],
        ['Asia/Beirut', '2026-10-25', 2],
        ['Asia/Beirut', '2027-03-28', 2],
        ['Asia/Beirut', '2027-10-31', 2],
        ['Australia/Lord_Howe', '2026-04-05', 2],
        ['Australia/Lord_Howe', '2026-10-04', 2],
        ['Asia/Kathmandu', '1986-01-01', 2],
        ['Asia/Kathmandu', '2026-06-01', 1],
        ['Pacific/Chatham', '2026-04-05', 2],
        ['Pacific/Chatham', '2026-09-27', 2],
        ['Europe/Dublin', '2026-03-29', 2],
        ['Europe/Dublin', '2026-10-25', 2],
        ['Europe/London', '2001-10-28', 2],
        ['America/New_York', '2035-11-04', 2],
        ['Asia/Beirut', '2026-07-15', 1], // ordinary weeks
        ['Asia/Beirut', '2026-12-15', 1],
        ['UTC', '2026-06-01', 1],
      ];
      let checked = 0;
      for (const [zone, iso, weeks] of windows) {
        const z = IANAZone.create(zone);
        const mid = Date.parse(`${iso}T00:00:00Z`);
        // Two passes: cold (fills the memo) and warm (served from it).
        for (let pass = 0; pass < 2; pass++)
          for (let t = mid - (weeks * WEEK) / 2; t <= mid + (weeks * WEEK) / 2; t += FIFTEEN) {
            const got = __slotCachesForTests.offsetMs(zone, t);
            if (got !== z.offset(t) * 60_000) expect.fail(`${zone} @ ${new Date(t).toISOString()}`);
            checked++;
          }
      }
      expect(checked).toBeGreaterThan(40_000);
    },
  );

  it('never creates cache entries for an invalid zone', () => {
    __slotCachesForTests.clear();
    expect(Number.isNaN(__slotCachesForTests.offsetMs('Not/AZone', 1_800_000_000_000))).toBe(true);
    expect(__slotCachesForTests.sizes()).toMatchObject({ zones: 0, outer: 0, localUtc: 0 });
  });

  it('a 14-day window stays well under the per-zone bucket cap', () => {
    __slotCachesForTests.clear();
    const input = makeCase(rng(3));
    generateSlots({
      ...input,
      timezone: 'Asia/Beirut',
      range: { from: '2026-11-01', to: '2026-11-14' },
    });
    expect(__slotCachesForTests.sizes().maxBuckets).toBeLessThan(400);
  });

  it('eviction (tiny caps) does not change any result', { timeout: 120_000 }, () => {
    __slotCachesForTests.setCaps({ bucketsPerZone: 3, localUtc: 4 });
    try {
      __slotCachesForTests.clear();
      const r = rng(424242);
      for (let i = 0; i < 120; i++) {
        const input = makeCase(r);
        expect(JSON.stringify(generateSlots(input))).toBe(JSON.stringify(referenceSlots(input)));
        expect(__slotCachesForTests.sizes().maxBuckets).toBeLessThanOrEqual(3);
      }
    } finally {
      __slotCachesForTests.resetCaps();
      __slotCachesForTests.clear();
    }
  });
});
