import { describe, expect, it } from 'vitest';
import { mergeDayIntervals, mergeWeekIntervals } from '@/lib/setup/hoursMerge';

const d = (start: string, end: string) => ({ start, end });
const iv = (weekday: number, startLocal: string, endLocal: string) => ({
  weekday,
  startLocal,
  endLocal,
});

describe('mergeDayIntervals', () => {
  it('merges touching blocks into one', () => {
    expect(mergeDayIntervals([d('09:00', '17:00'), d('17:00', '22:00')])).toEqual([d('09:00', '22:00')]);
  });
  it('keeps a real break as two blocks', () => {
    expect(mergeDayIntervals([d('09:00', '12:00'), d('13:00', '17:00')])).toEqual([
      d('09:00', '12:00'),
      d('13:00', '17:00'),
    ]);
  });
  it('merges three chained blocks', () => {
    expect(
      mergeDayIntervals([d('09:00', '12:00'), d('12:00', '15:00'), d('15:00', '18:00')]),
    ).toEqual([d('09:00', '18:00')]);
  });
  it('handles an end of 24:00', () => {
    expect(mergeDayIntervals([d('18:00', '24:00'), d('09:00', '18:00')])).toEqual([d('09:00', '24:00')]);
  });
  it('sorts unsorted input', () => {
    expect(mergeDayIntervals([d('13:00', '17:00'), d('09:00', '12:00')])).toEqual([
      d('09:00', '12:00'),
      d('13:00', '17:00'),
    ]);
  });
  it('unions overlapping blocks', () => {
    expect(
      mergeDayIntervals([d('09:00', '14:00'), d('12:00', '17:00'), d('10:00', '11:00')]),
    ).toEqual([d('09:00', '17:00')]);
  });
  it('is idempotent and does not mutate its input', () => {
    const input = [d('09:00', '12:00'), d('12:00', '15:00'), d('16:00', '18:00')];
    const copy = JSON.parse(JSON.stringify(input));
    const once = mergeDayIntervals(input);
    expect(input).toEqual(copy);
    expect(mergeDayIntervals(once)).toEqual(once);
    expect(once).toEqual([d('09:00', '15:00'), d('16:00', '18:00')]);
  });
  it('never returns more blocks than it was given (MAX_INTERVALS_PER_DAY holds)', () => {
    const six = Array.from({ length: 6 }, (_, k) =>
      d(`${String(8 + k * 2).padStart(2, '0')}:00`, `${String(9 + k * 2).padStart(2, '0')}:00`),
    );
    expect(mergeDayIntervals(six)).toHaveLength(6);
    expect(mergeDayIntervals([...six, d('09:00', '10:00')]).length).toBeLessThanOrEqual(6);
  });
  it('leaves malformed entries alone', () => {
    expect(mergeDayIntervals([d('xx', '10:00'), d('09:00', '10:00')])).toHaveLength(2);
  });
});

describe('mergeWeekIntervals', () => {
  it('merges per weekday and returns sorted output', () => {
    expect(
      mergeWeekIntervals([iv(3, '17:00', '22:00'), iv(1, '09:00', '12:00'), iv(3, '09:00', '17:00')]),
    ).toEqual([iv(1, '09:00', '12:00'), iv(3, '09:00', '22:00')]);
  });
  it('does NOT merge across days (the midnight split stays)', () => {
    const split = [
      iv(1, '09:00', '24:00'),
      iv(2, '00:00', '02:00'),
      iv(0, '09:00', '24:00'),
      iv(1, '00:00', '02:00'),
    ];
    expect(mergeWeekIntervals(split)).toEqual([
      iv(0, '09:00', '24:00'),
      iv(1, '00:00', '02:00'),
      iv(1, '09:00', '24:00'),
      iv(2, '00:00', '02:00'),
    ]);
  });
  it('is idempotent', () => {
    const once = mergeWeekIntervals([
      iv(2, '09:00', '12:00'),
      iv(2, '12:00', '15:00'),
      iv(5, '10:00', '11:00'),
    ]);
    expect(mergeWeekIntervals(once)).toEqual(once);
  });
});

/** Small seeded PRNG (mulberry32): the same seed always draws the same cases, so a failure is reproducible. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
const covered = (blocks: { start: string; end: string }[]) => {
  const set = new Set<number>();
  for (const b of blocks) for (let m = toMin(b.start); m < toMin(b.end); m++) set.add(m);
  return [...set].sort((x, y) => x - y);
};

describe('mergeDayIntervals, seeded random cases', () => {
  it('keeps the covered minutes unchanged, is idempotent, sorted and never touching', () => {
    const rand = mulberry32(20261107);
    for (let run = 0; run < 400; run++) {
      const count = 1 + Math.floor(rand() * 6);
      const day = Array.from({ length: count }, () => {
        const s = Math.floor(rand() * 287) * 5; // 00:00 .. 23:50 in 5 min steps
        const e = Math.min(1440, s + 5 * (1 + Math.floor(rand() * 60)));
        return d(hhmm(s), hhmm(e));
      });
      const once = mergeDayIntervals(day);
      expect(once.length, `run ${run}`).toBeLessThanOrEqual(day.length);
      expect(covered(once), `run ${run}: covered minutes`).toEqual(covered(day));
      expect(mergeDayIntervals(once), `run ${run}: idempotent`).toEqual(once);
      for (let i = 1; i < once.length; i++)
        expect(toMin(once[i]!.start), `run ${run}: gap between blocks`).toBeGreaterThan(toMin(once[i - 1]!.end));
    }
  });

  it('weekly merge keeps every weekday separate and idempotent', () => {
    const rand = mulberry32(48);
    for (let run = 0; run < 200; run++) {
      const week = Array.from({ length: 1 + Math.floor(rand() * 8) }, () => {
        const s = Math.floor(rand() * 280) * 5;
        return iv(Math.floor(rand() * 7), hhmm(s), hhmm(Math.min(1440, s + 5 * (1 + Math.floor(rand() * 40)))));
      });
      const once = mergeWeekIntervals(week);
      expect(mergeWeekIntervals(once), `run ${run}`).toEqual(once);
      for (let wd = 0; wd < 7; wd++)
        expect(
          covered(once.filter((i) => i.weekday === wd).map((i) => d(i.startLocal, i.endLocal))),
          `run ${run} day ${wd}`,
        ).toEqual(covered(week.filter((i) => i.weekday === wd).map((i) => d(i.startLocal, i.endLocal))));
    }
  });
});
