import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { makeRng } from '../../../scripts/demo/rng';
import {
  demandWeight,
  placeDay,
  splitCapacity,
  weekdayOf,
  workingIntervals,
  type ServiceLoad,
} from '../../../scripts/demo/schedule';

const ZONE = 'Asia/Beirut';
const HOURS = {
  1: [['09:00', '13:00'], ['14:00', '18:00']] as [string, string][],
  5: [['09:00', '13:00'], ['14:00', '18:00']] as [string, string][],
  6: [['09:00', '14:00']] as [string, string][],
};
const SERVICES: ServiceLoad[] = [
  { durationMin: 45, bufferMin: 0, weight: 4 },
  { durationMin: 45, bufferMin: 15, weight: 3 },
  { durationMin: 90, bufferMin: 15, weight: 1 },
  { durationMin: 30, bufferMin: 0, weight: 1 },
];
const day = (iso: string) => DateTime.fromISO(iso, { zone: ZONE });

describe('workingIntervals', () => {
  it('is empty on Sunday and has a lunch split on weekdays', () => {
    expect(workingIntervals(day('2026-11-08'), HOURS)).toEqual([]); // Sunday
    expect(workingIntervals(day('2026-11-09'), HOURS)).toHaveLength(2); // Monday
    expect(weekdayOf(day('2026-11-08'))).toBe(0);
  });

  it('keeps 09:00 local across both Beirut DST changes', () => {
    // Beirut moves at midnight: 29 Mar 2026 (spring forward) and 25 Oct 2026 (fall back).
    for (const iso of ['2026-03-27', '2026-03-30', '2026-10-23', '2026-10-26']) {
      const iv = workingIntervals(day(iso), HOURS);
      expect(iv.length).toBeGreaterThan(0);
      const first = DateTime.fromMillis(iv[0]!.startMs, { zone: ZONE });
      expect(first.toFormat('HH:mm')).toBe('09:00');
      expect(first.toISODate()).toBe(iso);
    }
    // UTC offsets differ on the two sides of the change: +2 before, +3 after (spring).
    const before = workingIntervals(day('2026-03-27'), HOURS)[0]!.startMs;
    const after = workingIntervals(day('2026-03-30'), HOURS)[0]!.startMs;
    expect(new Date(before).getUTCHours()).toBe(7);
    expect(new Date(after).getUTCHours()).toBe(6);
  });
});

describe('placeDay', () => {
  const run = (iso: string, seed: number, target = { pastMinutes: 200, futureMinutes: 0 }, now?: number) => {
    const d = day(iso);
    const intervals = workingIntervals(d, HOURS);
    return {
      intervals,
      slots: placeDay(makeRng(seed), intervals, SERVICES, target, now ?? d.plus({ days: 2 }).toMillis()),
    };
  };

  it('never overlaps (blocked range) and stays inside the working intervals', () => {
    for (const iso of ['2026-03-27', '2026-03-30', '2026-10-23', '2026-10-26', '2026-11-09', '2026-11-14']) {
      for (let seed = 1; seed <= 25; seed++) {
        const { intervals, slots } = run(iso, seed, { pastMinutes: 260, futureMinutes: 0 });
        for (let i = 0; i < slots.length; i++) {
          const s = slots[i]!;
          expect(s.endMs).toBeGreaterThan(s.startMs);
          expect(s.blockedMs).toBeGreaterThanOrEqual(s.endMs);
          expect(intervals.some((iv) => s.startMs >= iv.startMs && s.blockedMs <= iv.endMs)).toBe(true);
          expect(((s.startMs - intervals[0]!.startMs) / 60_000) % 15).toBe(0);
          for (let j = i + 1; j < slots.length; j++) {
            const o = slots[j]!;
            expect(s.blockedMs <= o.startMs || o.blockedMs <= s.startMs).toBe(true);
          }
        }
      }
    }
  });

  it('reaches roughly the requested fill and is deterministic', () => {
    const a = run('2026-11-09', 5, { pastMinutes: 300, futureMinutes: 0 });
    const filled = a.slots.reduce((sum, s) => sum + (s.blockedMs - s.startMs) / 60_000, 0);
    expect(filled).toBeGreaterThanOrEqual(240);
    expect(filled).toBeLessThanOrEqual(330);
    expect(run('2026-11-09', 5, { pastMinutes: 300, futureMinutes: 0 }).slots).toEqual(a.slots);
  });

  it('treats past and future parts of today separately', () => {
    const d = day('2026-11-09');
    const intervals = workingIntervals(d, HOURS);
    const now = d.set({ hour: 13, minute: 30 }).toMillis();
    const slots = placeDay(makeRng(2), intervals, SERVICES, { pastMinutes: 150, futureMinutes: 120 }, now);
    expect(slots.some((s) => s.blockedMs <= now)).toBe(true);
    expect(slots.some((s) => s.startMs >= now)).toBe(true);
    for (const s of slots) expect(s.startMs < now && s.blockedMs > now).toBe(false);
  });

  it('prefers the morning and late-afternoon peaks', () => {
    expect(demandWeight(0.15)).toBeGreaterThan(demandWeight(0.5));
    expect(demandWeight(0.86)).toBeGreaterThan(demandWeight(0.5));
  });

  it('splits capacity around now', () => {
    const d = day('2026-11-09');
    const iv = workingIntervals(d, HOURS);
    expect(splitCapacity(iv, d.set({ hour: 8 }).toMillis())).toEqual({ past: 0, future: 480 });
    expect(splitCapacity(iv, d.set({ hour: 19 }).toMillis())).toEqual({ past: 480, future: 0 });
    expect(splitCapacity(iv, d.set({ hour: 11 }).toMillis())).toEqual({ past: 120, future: 360 });
  });
});
