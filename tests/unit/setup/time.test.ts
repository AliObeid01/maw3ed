import { describe, expect, it } from 'vitest';
import {
  allDayLastDay,
  isAllDay,
  localToUtcIso,
  startOfDayLocal,
  utcIsoToLocal,
  utcOffsetLabel,
} from '@/lib/setup/time';

describe('localToUtcIso / utcIsoToLocal (business timezone)', () => {
  it('uses UTC+2 in Beirut winter and UTC+3 after the March change', () => {
    expect(localToUtcIso('2026-03-28T12:00', 'Asia/Beirut')).toBe('2026-03-28T10:00:00Z');
    expect(localToUtcIso('2026-03-30T12:00', 'Asia/Beirut')).toBe('2026-03-30T09:00:00Z');
  });

  it('uses UTC+2 again after the October change', () => {
    expect(localToUtcIso('2026-10-24T12:00', 'Asia/Beirut')).toBe('2026-10-24T09:00:00Z');
    expect(localToUtcIso('2026-10-26T12:00', 'Asia/Beirut')).toBe('2026-10-26T10:00:00Z');
  });

  it('shifts a wall-clock time that does not exist (spring-forward gap) forward, never throws', () => {
    // Beirut jumps 00:00 -> 01:00 on 2026-03-29, so 00:30 does not exist.
    const iso = localToUtcIso('2026-03-29T00:30', 'Asia/Beirut');
    expect(iso).toBe('2026-03-28T22:30:00Z');
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
