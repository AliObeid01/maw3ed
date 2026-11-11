import { describe, expect, it } from 'vitest';
import {
  DAY_MAX,
  DAY_MIN,
  clampDay,
  dayShortcuts,
  normalizeDay,
  shiftDayClamped,
  todayKey,
  weekOf,
  inDayBounds,
} from '@/lib/dashboard/dayPicker';

const BEIRUT = 'Asia/Beirut';

describe('bounds', () => {
  it('allows 2000-01-01 to 2100-12-31 and clamps outside', () => {
    expect(DAY_MIN).toBe('2000-01-01');
    expect(DAY_MAX).toBe('2100-12-31');
    expect(clampDay('1999-12-31')).toBe('2000-01-01');
    expect(clampDay('2101-01-01')).toBe('2100-12-31');
    expect(clampDay('2026-11-11')).toBe('2026-11-11');
  });
  it('shifting never leaves the bounds', () => {
    expect(shiftDayClamped('2000-01-01', -1)).toBe('2000-01-01');
    expect(shiftDayClamped('2100-12-31', 1)).toBe('2100-12-31');
  });
});

describe('day arithmetic', () => {
  it('crosses month and year boundaries and leap days', () => {
    expect(shiftDayClamped('2026-11-30', 1)).toBe('2026-12-01');
    expect(shiftDayClamped('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDayClamped('2028-03-01', -1)).toBe('2028-02-29');
    expect(shiftDayClamped('2026-11-11', -21)).toBe('2026-10-21');
  });
  it('steps one calendar day over the Beirut DST changes (23 h and 25 h days)', () => {
    expect(shiftDayClamped('2026-03-28', 1)).toBe('2026-03-29');
    expect(shiftDayClamped('2026-03-29', 1)).toBe('2026-03-30');
    expect(shiftDayClamped('2026-03-30', -1)).toBe('2026-03-29');
    expect(shiftDayClamped('2026-10-24', 1)).toBe('2026-10-25');
    expect(shiftDayClamped('2026-10-25', 1)).toBe('2026-10-26');
    expect(shiftDayClamped('2026-10-26', -2)).toBe('2026-10-24');
  });
});

describe('todayKey (business timezone)', () => {
  it('uses the business zone, not UTC', () => {
    // 22:30 UTC on 6 Nov is already the 7th in Beirut (UTC+2).
    expect(todayKey(BEIRUT, new Date('2026-11-06T22:30:00Z'))).toBe('2026-11-07');
    expect(todayKey('UTC', new Date('2026-11-06T22:30:00Z'))).toBe('2026-11-06');
  });
  it('is right just after the spring-forward gap (Beirut 29 Mar 2026, 00:00 -> 01:00)', () => {
    // 21:30 UTC on the 28th = 23:30 Beirut on the 28th (still UTC+2); 22:00 UTC = 01:00 EEST on the 29th.
    expect(todayKey(BEIRUT, new Date('2026-03-28T21:30:00Z'))).toBe('2026-03-28');
    expect(todayKey(BEIRUT, new Date('2026-03-28T22:00:00Z'))).toBe('2026-03-29');
  });
  it('is right around the autumn repeat hour (Beirut 24 Oct 2026: 00:00 EEST -> 23:00 EET, a 25 h day)', () => {
    expect(todayKey(BEIRUT, new Date('2026-10-24T20:30:00Z'))).toBe('2026-10-24'); // 23:30 EEST
    expect(todayKey(BEIRUT, new Date('2026-10-24T21:30:00Z'))).toBe('2026-10-24'); // 23:30 EET, the repeated hour
    expect(todayKey(BEIRUT, new Date('2026-10-24T22:00:00Z'))).toBe('2026-10-25');
    expect(todayKey(BEIRUT, new Date('2026-10-25T21:30:00Z'))).toBe('2026-10-25');
    expect(todayKey(BEIRUT, new Date('2026-10-25T22:00:00Z'))).toBe('2026-10-26');
  });
});

describe('normalizeDay', () => {
  it('returns null for the real today (so the page keeps following the clock) and clamps the rest', () => {
    expect(normalizeDay('2026-11-11', '2026-11-11')).toBeNull();
    expect(normalizeDay('2026-10-21', '2026-11-11')).toBe('2026-10-21');
    expect(normalizeDay('1990-01-01', '2026-11-11')).toBe('2000-01-01');
  });
  it('rejects garbage (null = today)', () => {
    expect(normalizeDay('2026-13-40', '2026-11-11')).toBeNull();
    expect(normalizeDay('tomorrow', '2026-11-11')).toBeNull();
    expect(normalizeDay('', '2026-11-11')).toBeNull();
  });
});

describe('dayShortcuts', () => {
  it('offers yesterday, tomorrow, a week back and a week ahead of today', () => {
    expect(dayShortcuts('2026-11-11')).toEqual([
      { id: 'yesterday', ymd: '2026-11-10' },
      { id: 'tomorrow', ymd: '2026-11-12' },
      { id: 'lastWeek', ymd: '2026-11-04' },
      { id: 'nextWeek', ymd: '2026-11-18' },
    ]);
  });
  it('is DST-safe', () => {
    expect(dayShortcuts('2026-03-29').map((s) => s.ymd)).toEqual([
      '2026-03-28',
      '2026-03-30',
      '2026-03-22',
      '2026-04-05',
    ]);
  });
});

describe('weekOf', () => {
  it('lists the 7 days of the week containing the day, Monday first', () => {
    expect(weekOf('2026-11-11')).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
    ]);
  });
  it('a Sunday belongs to the week that ends on it, and weeks cross months', () => {
    expect(weekOf('2026-11-15')[0]).toBe('2026-11-09');
    expect(weekOf('2026-12-31')).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
  });
});

describe('week chips at the bounds', () => {
  it('flags the days of the week of 2000-01-01 and 2100-12-31 that fall outside the allowed range', () => {
    const first = weekOf('2000-01-01'); // Saturday: the week starts on 1999-12-27
    expect(first.filter((d) => !inDayBounds(d))).toEqual(['1999-12-27', '1999-12-28', '1999-12-29', '1999-12-30', '1999-12-31']);
    expect(first.filter(inDayBounds)).toEqual(['2000-01-01', '2000-01-02']);
    const last = weekOf('2100-12-31'); // Friday: the week ends on 2101-01-02
    expect(last.filter((d) => !inDayBounds(d))).toEqual(['2101-01-01', '2101-01-02']);
    expect(last.filter(inDayBounds)).toHaveLength(5);
  });
});
