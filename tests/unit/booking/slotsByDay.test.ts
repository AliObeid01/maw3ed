import { describe, expect, it } from 'vitest';
import {
  dayPart,
  dayWindow,
  findSlotByLocalTime,
  groupSlotsByDay,
  localDay,
  localTime,
  partitionByDayPart,
  replaceDay,
  slotMatchesTime,
  slotTime,
  timezonesDiffer,
} from '@/lib/booking/slots';

const slot = (startAt: string) => ({ startAt, endAt: startAt });

describe('groupSlotsByDay (business timezone, across DST)', () => {
  it('groups by the local day in the business timezone, not the server or UTC day', () => {
    // 22:30Z on 1 Nov is already 00:30 on 2 Nov in Beirut (UTC+2), still 1 Nov in UTC and New York.
    const slots = [slot('2026-11-01T22:30:00Z'), slot('2026-11-01T08:00:00Z')];
    expect(Object.keys(groupSlotsByDay(slots, 'Asia/Beirut')).sort()).toEqual([
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(Object.keys(groupSlotsByDay(slots, 'America/New_York'))).toEqual(['2026-11-01']);
  });

  it('moves the midnight boundary with the spring-forward change (Beirut, 29 Mar 2026 00:00 -> 01:00)', () => {
    // Offset is +2 until 22:00Z on 28 Mar, then +3.
    const grouped = groupSlotsByDay(
      [
        slot('2026-03-28T21:59:00Z'), // 23:59 on the 28th
        slot('2026-03-28T22:00:00Z'), // 01:00 on the 29th
        slot('2026-03-29T20:59:00Z'), // 23:59 on the 29th (+3)
        slot('2026-03-29T21:00:00Z'), // 00:00 on the 30th
      ],
      'Asia/Beirut',
    );
    expect(Object.keys(grouped)).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
    expect(grouped['2026-03-29']).toHaveLength(2);
  });

  it('keeps the repeated hour on one day across the fall-back change (Beirut, 25 Oct 2026 00:00 -> 23:00)', () => {
    // Offset is +3 until 21:00Z on 24 Oct, then +2: 23:00-23:59 on the 24th happens twice.
    expect(localDay('2026-10-24T20:30:00Z', 'Asia/Beirut')).toBe('2026-10-24'); // 23:30 (+3)
    expect(localDay('2026-10-24T21:30:00Z', 'Asia/Beirut')).toBe('2026-10-24'); // 23:30 again (+2)
    expect(localDay('2026-10-24T22:00:00Z', 'Asia/Beirut')).toBe('2026-10-25'); // 00:00
    expect(localDay('2026-10-25T22:00:00Z', 'Asia/Beirut')).toBe('2026-10-26');
  });

  it('sorts each day by start time', () => {
    const grouped = groupSlotsByDay(
      [slot('2026-11-02T10:00:00Z'), slot('2026-11-02T07:00:00Z'), slot('2026-11-02T08:30:00Z')],
      'Asia/Beirut',
    );
    expect(grouped['2026-11-02']!.map((s) => localTime(s.startAt, 'Asia/Beirut'))).toEqual([
      '09:00',
      '10:30',
      '12:00',
    ]);
  });
});

describe('dayWindow', () => {
  it('lists consecutive calendar days from today in the business timezone', () => {
    // 23:30Z on 1 Nov is already 2 Nov in Beirut.
    const days = dayWindow(new Date('2026-11-01T23:30:00Z'), 'Asia/Beirut', 3);
    expect(days).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
  });

  it('has no gap or repeat across both DST changes', () => {
    const spring = dayWindow(new Date('2026-03-26T10:00:00Z'), 'Asia/Beirut', 14);
    expect(spring).toHaveLength(14);
    expect(spring.slice(2, 6)).toEqual(['2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31']);
    const fall = dayWindow(new Date('2026-10-22T10:00:00Z'), 'Asia/Beirut', 14);
    expect(new Set(fall).size).toBe(14);
    expect(fall.slice(2, 6)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
  });
});

describe('day parts, lookups and replacing a day', () => {
  it('splits morning, afternoon and evening by local hour', () => {
    expect(dayPart('2026-11-02T07:59:00Z', 'Asia/Beirut')).toBe('morning'); // 09:59
    expect(dayPart('2026-11-02T10:00:00Z', 'Asia/Beirut')).toBe('afternoon'); // 12:00
    expect(dayPart('2026-11-02T15:00:00Z', 'Asia/Beirut')).toBe('evening'); // 17:00
    const parts = partitionByDayPart(
      [slot('2026-11-02T07:00:00Z'), slot('2026-11-02T15:30:00Z')],
      'Asia/Beirut',
    );
    expect(parts.map((p) => p.part)).toEqual(['morning', 'evening']);
  });

  it('finds a slot by its local HH:mm', () => {
    const list = [slot('2026-11-02T08:30:00Z')];
    expect(findSlotByLocalTime(list, 'Asia/Beirut', '10:30')).toBe(list[0]);
    expect(findSlotByLocalTime(list, 'Asia/Beirut', '08:30')).toBeUndefined();
  });

  it('replaces one local day with the 409 payload and leaves the others alone', () => {
    const before = groupSlotsByDay(
      [slot('2026-11-02T08:00:00Z'), slot('2026-11-02T09:00:00Z'), slot('2026-11-03T08:00:00Z')],
      'Asia/Beirut',
    );
    const after = replaceDay(before, '2026-11-02', [slot('2026-11-02T09:00:00Z')], 'Asia/Beirut');
    expect(after['2026-11-02']).toHaveLength(1);
    expect(after['2026-11-03']).toBe(before['2026-11-03']);
    expect(replaceDay(before, '2026-11-02', [], 'Asia/Beirut')['2026-11-02']).toEqual([]);
  });
});

describe('time tokens on the DST fall-back night (Asia/Beirut, 24 Oct 2026 23:xx happens twice, F19)', () => {
  // Beirut falls back at 00:00 EEST on 25 Oct: 23:30 on the 24th is first +03:00 (20:30Z), then +02:00 (21:30Z).
  const first = slot('2026-10-24T20:30:00Z');
  const second = slot('2026-10-24T21:30:00Z');
  const zone = 'Asia/Beirut';

  it('both instants read 23:30 on the wall clock but carry different tokens', () => {
    expect(localTime(first.startAt, zone)).toBe('23:30');
    expect(localTime(second.startAt, zone)).toBe('23:30');
    expect(slotTime(first.startAt, zone)).toBe('23:30+03:00');
    expect(slotTime(second.startAt, zone)).toBe('23:30+02:00');
  });

  it('a token with the offset resolves to exactly that slot', () => {
    expect(findSlotByLocalTime([first, second], zone, '23:30+02:00')).toBe(second);
    expect(findSlotByLocalTime([first, second], zone, '23:30+03:00')).toBe(first);
    expect(slotMatchesTime(first, zone, '23:30+02:00')).toBe(false);
  });

  it('an old HH:mm link still works and picks the first occurrence', () => {
    expect(findSlotByLocalTime([first, second], zone, '23:30')).toBe(first);
  });

  it('an ordinary slot round trips, and a token with the wrong offset finds nothing', () => {
    const noon = slot('2026-11-03T10:00:00Z');
    expect(slotTime(noon.startAt, zone)).toBe('12:00+02:00');
    expect(findSlotByLocalTime([noon], zone, '12:00+02:00')).toBe(noon);
    expect(findSlotByLocalTime([noon], zone, '12:00+03:00')).toBeUndefined();
  });
});

describe('timezonesDiffer', () => {
  const now = new Date('2026-11-02T10:00:00Z');
  it('is false for the same zone and for different zones with the same offset', () => {
    expect(timezonesDiffer(now, 'Asia/Beirut', 'Asia/Beirut')).toBe(false);
    expect(timezonesDiffer(now, 'Asia/Beirut', 'Europe/Athens')).toBe(false);
  });
  it('is true when the offsets differ', () => {
    expect(timezonesDiffer(now, 'Asia/Beirut', 'America/New_York')).toBe(true);
    expect(timezonesDiffer(now, 'Asia/Beirut', 'UTC')).toBe(true);
  });
});
