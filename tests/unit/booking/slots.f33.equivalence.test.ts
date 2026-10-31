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
} from './slotsReferencePre33';

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
  const [from, to] = pick(r, RANGES);
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
    // ids deliberately not in sorted order, and with a shared prefix, to exercise the id tie-break
    return {
      id: `staff-${String(staffCount - i).padStart(2, '0')}-${i % 3}`,
      weeklyHours: weekly(r),
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
    timezone: pick(r, ZONES),
    now: new Date(base - nowOffsetMs),
    range: { from, to },
  };
}

describe('F33: generateSlots / mergeAnyone equal the pre-optimisation implementation', () => {
  it(
    'matches on 700 randomised cases (1 to 10 staff), slots and the anyone merge, same order',
    {
      timeout: 170_000,
    },
    () => {
      const r = rng(20261031);
      let nonEmpty = 0;
      let multiCandidate = 0;
      for (let i = 0; i < 700; i++) {
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
      expect(nonEmpty).toBeGreaterThan(350);
      expect(multiCandidate).toBeGreaterThan(100);
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
