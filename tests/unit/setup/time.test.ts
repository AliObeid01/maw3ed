import { DateTime, Settings } from 'luxon';
import { afterEach, describe, expect, it } from 'vitest';
import {
  allDayLastDay,
  isAllDay,
  localToUtcIso,
  resolveLocalToUtc,
  startOfDayLocal,
  utcIsoToLocal,
  utcOffsetLabel,
} from '@/lib/setup/time';

/** The REAL Beirut spring-forward days: the first date whose offset is larger than the day before. */
function springForwardDay(year: number, timezone: string): string {
  let prev = DateTime.fromObject({ year, month: 1, day: 1 }, { zone: timezone });
  for (let i = 0; i < 366; i++) {
    const next = prev.plus({ days: 1 });
    if (next.offset > prev.offset) return next.toISODate()!;
    prev = next;
  }
  throw new Error('no spring-forward day');
}
const SPRING_2026 = springForwardDay(2026, 'Asia/Beirut');
const SPRING_2027 = springForwardDay(2027, 'Asia/Beirut');

describe('real transition dates', () => {
  it('are 29 Mar 2026 and 28 Mar 2027', () => {
    expect([SPRING_2026, SPRING_2027]).toEqual(['2026-03-29', '2027-03-28']);
  });
});

describe('localToUtcIso / utcIsoToLocal (business timezone)', () => {
  it('uses UTC+2 in Beirut winter and UTC+3 after the March change', () => {
    expect(localToUtcIso('2026-03-28T12:00', 'Asia/Beirut')).toBe('2026-03-28T10:00:00Z');
    expect(localToUtcIso('2026-03-30T12:00', 'Asia/Beirut')).toBe('2026-03-30T09:00:00Z');
  });

  it('uses UTC+2 again after the October change', () => {
    expect(localToUtcIso('2026-10-24T12:00', 'Asia/Beirut')).toBe('2026-10-24T09:00:00Z');
    expect(localToUtcIso('2026-10-26T12:00', 'Asia/Beirut')).toBe('2026-10-26T10:00:00Z');
  });

  it('rejects a wall-clock time that does not exist (spring-forward gap) instead of shifting it', () => {
    // Beirut jumps 00:00 -> 01:00 on 2026-03-29 and on 2027-03-28 (computed from the zone rules, not guessed).
    for (const day of [SPRING_2026, SPRING_2027]) {
      expect(localToUtcIso(`${day}T00:30`, 'Asia/Beirut')).toBeNull();
      expect(resolveLocalToUtc(`${day}T00:30`, 'Asia/Beirut')).toEqual({ ok: false, reason: 'nonexistent' });
      // Just after the gap and the end of the day are real times.
      expect(resolveLocalToUtc(`${day}T01:00`, 'Asia/Beirut').ok).toBe(true);
      expect(resolveLocalToUtc(`${day}T23:59`, 'Asia/Beirut').ok).toBe(true);
    }
    expect(resolveLocalToUtc('2026-02-30T10:00', 'Asia/Beirut')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('accepts the repeated fall-back hour and picks its FIRST occurrence (the earlier, UTC+3 one)', () => {
    // Beirut falls back at 00:00 -> 23:00 the evening before: 23:00-23:59 on 2026-10-24 happens twice.
    const iso = localToUtcIso('2026-10-24T23:30', 'Asia/Beirut');
    expect(iso).toBe('2026-10-24T20:30:00Z');
    // Luxon alone would pick the LATER occurrence (21:30Z); we document and use the first.
    expect(DateTime.fromISO(iso!, { zone: 'utc' }).setZone('Asia/Beirut').offset).toBe(180);
  });

  it('handles another zone on its own DST day', () => {
    expect(localToUtcIso('2026-03-08T12:00', 'America/New_York')).toBe('2026-03-08T16:00:00Z');
    expect(localToUtcIso('2026-03-07T12:00', 'America/New_York')).toBe('2026-03-07T17:00:00Z');
  });

  it('round-trips through UTC', () => {
    for (const zone of ['Asia/Beirut', 'America/New_York', 'Europe/London']) {
      const local = '2026-07-15T09:30';
      const iso = localToUtcIso(local, zone)!;
      expect(utcIsoToLocal(iso, zone)).toBe(local);
    }
  });

  it('is independent of the server zone: the same instant reads differently per zone', () => {
    expect(utcIsoToLocal('2026-01-10T22:30:00Z', 'Asia/Beirut')).toBe('2026-01-11T00:30');
    expect(utcIsoToLocal('2026-01-10T22:30:00Z', 'America/New_York')).toBe('2026-01-10T17:30');
  });

  it('returns null / empty for invalid input', () => {
    expect(localToUtcIso('', 'Asia/Beirut')).toBeNull();
    expect(localToUtcIso('2026-02-30T10:00', 'Asia/Beirut')).toBeNull();
    expect(utcIsoToLocal('nope', 'Asia/Beirut')).toBe('');
  });
});

describe('isAllDay', () => {
  it('is true for local midnight to a later local midnight, across the DST day', () => {
    const start = localToUtcIso('2026-03-28T00:00', 'Asia/Beirut')!;
    const end = localToUtcIso('2026-03-30T00:00', 'Asia/Beirut')!;
    expect(isAllDay(start, end, 'Asia/Beirut')).toBe(true);
  });

  it('is true for 00:00 to 23:59', () => {
    const start = localToUtcIso('2026-11-06T00:00', 'Asia/Beirut')!;
    const end = localToUtcIso('2026-11-06T23:59', 'Asia/Beirut')!;
    expect(isAllDay(start, end, 'Asia/Beirut')).toBe(true);
  });

  it('is false for a partial day or a reversed range', () => {
    const start = localToUtcIso('2026-11-06T09:00', 'Asia/Beirut')!;
    const end = localToUtcIso('2026-11-06T12:00', 'Asia/Beirut')!;
    expect(isAllDay(start, end, 'Asia/Beirut')).toBe(false);
    expect(isAllDay(end, start, 'Asia/Beirut')).toBe(false);
  });

  it('depends on the zone: UTC midnight is not Beirut midnight', () => {
    expect(isAllDay('2026-11-06T00:00:00Z', '2026-11-07T00:00:00Z', 'Asia/Beirut')).toBe(false);
    expect(isAllDay('2026-11-06T00:00:00Z', '2026-11-07T00:00:00Z', 'UTC')).toBe(true);
  });
});

describe('allDayLastDay', () => {
  it('treats an exclusive midnight end as the previous day', () => {
    const end = localToUtcIso('2026-11-07T00:00', 'Asia/Beirut')!;
    expect(utcIsoToLocal(allDayLastDay(end, 'Asia/Beirut').toISOString(), 'Asia/Beirut')).toBe(
      '2026-11-06T00:00',
    );
  });
});

describe('startOfDayLocal / utcOffsetLabel', () => {
  it('reads the day in the business zone, not the server zone', () => {
    const now = new Date('2026-01-10T22:30:00Z');
    expect(startOfDayLocal(now, 'Asia/Beirut')).toBe('2026-01-11T00:00');
    expect(startOfDayLocal(now, 'America/New_York')).toBe('2026-01-10T00:00');
    expect(startOfDayLocal(now, 'Asia/Beirut', 1)).toBe('2026-01-12T00:00');
  });

  it('labels the offset at the given moment', () => {
    expect(utcOffsetLabel('Asia/Beirut', new Date('2026-01-10T12:00:00Z'))).toBe('UTC+2');
    expect(utcOffsetLabel('Asia/Beirut', new Date('2026-07-10T12:00:00Z'))).toBe('UTC+3');
    expect(utcOffsetLabel('Asia/Kolkata', new Date('2026-07-10T12:00:00Z'))).toBe('UTC+5:30');
    expect(utcOffsetLabel('America/New_York', new Date('2026-01-10T12:00:00Z'))).toBe('UTC-5');
  });
});

describe('F58: independent of the Luxon default locale', () => {
  const before = Settings.defaultLocale;
  afterEach(() => {
    Settings.defaultLocale = before;
  });

  it('utcIsoToLocal and startOfDayLocal keep Latin digits under an Arabic default locale', () => {
    Settings.defaultLocale = 'ar-EG';
    expect(utcIsoToLocal('2026-01-10T22:30:00Z', 'Asia/Beirut')).toBe('2026-01-11T00:30');
    expect(startOfDayLocal(new Date('2026-01-10T22:30:00Z'), 'Asia/Beirut')).toBe('2026-01-11T00:00');
    expect(startOfDayLocal(new Date('2026-01-10T22:30:00Z'), 'Asia/Beirut', 1)).toBe('2026-01-12T00:00');
    expect(localToUtcIso('2026-01-11T00:30', 'Asia/Beirut')).toBe('2026-01-10T22:30:00Z');
  });
});
