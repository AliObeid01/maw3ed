import { describe, expect, it } from 'vitest';
import { generateSlots, type StaffAvailability, type Weekday } from '@/server/domain/slots';
import { generateSlots as referenceSlots } from './slotsReference';

/**
 * The optimised generateSlots (memoised conversions, arithmetic stepping inside intervals without a DST
 * transition) must match the original algorithm exactly. slotsReference.ts is a verbatim copy of the
 * pre-optimisation implementation.
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
  'Europe/London',
  'America/New_York',
  'Australia/Lord_Howe',
];
const RANGES: [string, string][] = [
  ['2026-03-27', '2026-03-31'], // Beirut spring forward on the 29th
  ['2026-10-23', '2026-10-27'], // Beirut fall back on the 25th (24th evening)
  ['2026-03-28', '2026-03-29'],
  ['2026-10-24', '2026-10-25'],
  ['2026-11-02', '2026-11-05'],
  ['2026-03-07', '2026-03-09'], // US spring forward
  ['2026-10-31', '2026-11-02'],
];

function weekly(r: () => number, full: boolean) {
  const out: StaffAvailability['weeklyHours'] = [];
  for (let wd = 0; wd < 7; wd++) {
    if (full) {
      out.push({ weekday: wd as Weekday, startLocal: '00:00', endLocal: '24:00' });
      continue;
    }
    if (r() < 0.15) continue;
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
      const a = pick(r, [0, 0, 60, 8 * 60, 9 * 60, 22 * 60, 23 * 60]);
      const b = pick(r, [a + 120, a + 480, 1440, 1440]);
      out.push({
        weekday: wd as Weekday,
        startLocal: hm(a),
        endLocal: b >= 1440 ? '24:00' : hm(b),
      });
    }
  }
  return out;
}

function makeCase(r: () => number) {
  const [from, to] = pick(r, RANGES);
  const base = Date.parse(`${from}T00:00:00Z`);
  const staff: StaffAvailability[] = Array.from({ length: int(r, 1, 2) }, (_, i) => {
    const full = r() < 0.25;
    const busy = Array.from({ length: int(r, 0, 8) }, () => {
      const startAt = new Date(base - 86_400_000 + Math.floor(r() * 7 * 86_400_000));
      return { startAt, blockedUntil: new Date(startAt.getTime() + int(r, 1, 12) * 15 * 60_000) };
    });
    const timeOff = Array.from({ length: int(r, 0, 2) }, () => {
      const startAt = new Date(base + Math.floor(r() * 6 * 86_400_000));
      return { startAt, endAt: new Date(startAt.getTime() + int(r, 1, 30) * 3_600_000) };
    });
    return { id: `s${i}`, weeklyHours: weekly(r, full), timeOff, busy };
  });
  return {
    service: {
      durationMin: pick(r, [5, 10, 15, 30, 45, 60, 90]),
      bufferMin: pick(r, [0, 0, 5, 15]),
    },
    staff,
    slotStepMin: pick(r, [15, 20, 30, 60]),
    minNoticeMin: pick(r, [0, 60, 120]),
    bookingWindowDays: pick(r, [30, 60, 365]),
    timezone: pick(r, ZONES),
    now: new Date(base - int(r, 0, 20) * 86_400_000 + int(r, 0, 1440) * 60_000),
    range: { from, to },
  };
}

describe('generateSlots equals the reference implementation', () => {
  it(
    'matches on 2000 randomised cases, including both Beirut DST days with full-day hours',
    { timeout: 180_000 },
    () => {
      const r = rng(20261029);
      let nonEmpty = 0;
      for (let i = 0; i < 2000; i++) {
        const input = makeCase(r);
        const got = generateSlots(input);
        const want = referenceSlots(input);
        if (JSON.stringify(got) !== JSON.stringify(want))
          expect.fail(
            `case ${i} differs: ${JSON.stringify(input.range)} ${input.timezone} step ${input.slotStepMin}`,
          );
        if (want.length) nonEmpty++;
      }
      expect(nonEmpty).toBeGreaterThan(1300);
    },
  );

  it('pins the two Beirut transitions with full-day hours (transition INSIDE a free interval)', () => {
    for (const range of [
      { from: '2026-03-29', to: '2026-03-29' },
      { from: '2026-10-24', to: '2026-10-25' },
    ]) {
      for (const slotStepMin of [5, 15, 30, 60]) {
        const input = {
          service: { durationMin: 30, bufferMin: 0 },
          staff: [
            {
              id: 'a',
              weeklyHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
                weekday: weekday as Weekday,
                startLocal: '00:00',
                endLocal: '24:00',
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
  });
});
