import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import {
  generateSlots,
  mergeAnyone,
  pickStaff,
  type GenerateSlotsInput,
  type StaffAvailability,
  type WeeklyInterval,
} from '@/server/domain/slots';

const ZONE = 'Asia/Beirut';
const NOW = new Date('2026-01-01T00:00:00Z');

function local(iso: string): Date {
  return DateTime.fromISO(iso, { zone: ZONE }).toJSDate();
}
function localHm(d: Date): string {
  return DateTime.fromJSDate(d, { zone: ZONE }).toFormat('HH:mm');
}

function staff(id: string, weeklyHours: WeeklyInterval[], extra: Partial<StaffAvailability> = {}): StaffAvailability {
  return { id, weeklyHours, timeOff: [], busy: [], ...extra };
}
const allWeek = (startLocal: string, endLocal: string): WeeklyInterval[] =>
  ([0, 1, 2, 3, 4, 5, 6] as const).map((weekday) => ({ weekday, startLocal, endLocal }));

function input(over: Partial<GenerateSlotsInput> & { staff: StaffAvailability[] }): GenerateSlotsInput {
  return {
    service: { durationMin: 30, bufferMin: 0 },
    slotStepMin: 30,
    minNoticeMin: 0,
    bookingWindowDays: 365,
    timezone: ZONE,
    now: NOW,
    range: { from: '2026-06-01', to: '2026-06-01' }, // Monday
    ...over,
  };
}
const starts = (slots: { startAt: Date }[]) => slots.map((s) => localHm(s.startAt));

describe('generateSlots basics', () => {
  it('uses weekday 0 = Sunday', () => {
    // 2026-06-07 is a Sunday
    const s = staff('a', [{ weekday: 0, startLocal: '10:00', endLocal: '11:00' }]);
    const slots = generateSlots(input({ staff: [s], range: { from: '2026-06-01', to: '2026-06-07' } }));
    expect(starts(slots)).toEqual(['10:00', '10:30']);
    expect(DateTime.fromJSDate(slots[0]!.startAt, { zone: ZONE }).toISODate()).toBe('2026-06-07');
  });

  it('returns slot shape with endAt and blockedUntil', () => {
    const s = staff('a', allWeek('09:00', '10:00'));
    const [first] = generateSlots(input({ staff: [s], service: { durationMin: 30, bufferMin: 10 } }));
    expect(first!.staffId).toBe('a');
    expect(first!.endAt.getTime() - first!.startAt.getTime()).toBe(30 * 60_000);
    expect(first!.blockedUntil.getTime() - first!.startAt.getTime()).toBe(40 * 60_000);
  });

  it('handles a split shift with a lunch break', () => {
    const s = staff('a', [
      { weekday: 1, startLocal: '09:00', endLocal: '12:00' },
      { weekday: 1, startLocal: '14:00', endLocal: '16:00' },
    ]);
    const slots = generateSlots(input({ staff: [s], service: { durationMin: 60, bufferMin: 0 }, slotStepMin: 60 }));
    expect(starts(slots)).toEqual(['09:00', '10:00', '11:00', '14:00', '15:00']);
  });

  it('emits nothing when the service is longer than the interval', () => {
    const s = staff('a', allWeek('09:00', '10:00'));
    expect(generateSlots(input({ staff: [s], service: { durationMin: 90, bufferMin: 0 } }))).toEqual([]);
  });

  it('only fits a slot when duration + buffer fits the remaining interval', () => {
    const s = staff('a', allWeek('09:00', '10:00'));
    const slots = generateSlots(input({ staff: [s], service: { durationMin: 30, bufferMin: 15 } }));
    // 09:00 needs until 09:45 OK, 09:30 needs until 10:15 > 10:00
    expect(starts(slots)).toEqual(['09:00']);
  });

  it('skips slots overlapping time off', () => {
    const s = staff('a', allWeek('09:00', '12:00'), {
      timeOff: [{ startAt: local('2026-06-01T10:00'), endAt: local('2026-06-01T11:00') }],
    });
    expect(starts(generateSlots(input({ staff: [s] })))).toEqual(['09:00', '09:30', '11:00', '11:30']);
  });

  it('a busy interval blocks its buffer; the next slot starts at blockedUntil', () => {
    const s = staff('a', allWeek('09:00', '12:00'), {
      busy: [{ startAt: local('2026-06-01T10:00'), blockedUntil: local('2026-06-01T10:40') }],
    });
    const slots = generateSlots(
      input({ staff: [s], service: { durationMin: 30, bufferMin: 10 }, slotStepMin: 10 }),
    );
    const t = starts(slots);
    // a slot must end (with buffer) by 10:00: latest 09:20; next free from 10:40
    expect(t).toContain('09:20');
    expect(t).not.toContain('09:30');
    expect(t).not.toContain('10:30');
    expect(t).toContain('10:40');
    expect(t).toContain('11:20'); // 11:20 + 40 min = 12:00 exactly
    expect(t).not.toContain('11:30');
  });

  it('aligns to the local step grid after an odd-length busy interval', () => {
    const s = staff('a', allWeek('09:00', '12:00'), {
      busy: [{ startAt: local('2026-06-01T09:00'), blockedUntil: local('2026-06-01T09:50') }],
    });
    const slots = generateSlots(input({ staff: [s], slotStepMin: 15 }));
    expect(starts(slots)[0]).toBe('10:00');
  });
});

describe('overlapping working-hour rows', () => {
  it('never lists the same start twice for one staff member', () => {
    // An owner can enter overlapping intervals on the setup screen; the customer must not see duplicates.
    const s = staff('a', [
      { weekday: 1, startLocal: '09:00', endLocal: '11:00' },
      { weekday: 1, startLocal: '10:00', endLocal: '12:00' },
    ]);
    const slots = generateSlots(input({ staff: [s] })); // 2026-06-01 is a Monday
    expect(starts(slots)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
    expect(new Set(slots.map((x) => x.startAt.getTime())).size).toBe(slots.length);
  });
});

describe('minimum notice and booking window', () => {
  const s = staff('a', allWeek('09:00', '12:00'));
  it('drops starts before now + minNotice (inclusive boundary kept)', () => {
    const now = local('2026-06-01T08:00');
    const slots = generateSlots(input({ staff: [s], now, minNoticeMin: 60 }));
    expect(starts(slots)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
    const later = generateSlots(input({ staff: [s], now, minNoticeMin: 61 }));
    expect(starts(later)[0]).toBe('09:30');
  });

  it('drops everything in the past', () => {
    const now = local('2026-06-01T10:10');
    expect(starts(generateSlots(input({ staff: [s], now })))).toEqual(['10:30', '11:00', '11:30']);
  });

  it('excludes starts at or after now + bookingWindowDays', () => {
    const now = local('2026-06-01T10:00');
    const slots = generateSlots(
      input({ staff: [s], now, bookingWindowDays: 1, range: { from: '2026-06-02', to: '2026-06-02' } }),
    );
    // window end = 2026-06-02T10:00 -> 09:00, 09:30 in; 10:00 excluded
    expect(starts(slots)).toEqual(['09:00', '09:30']);
  });
});

describe('anyone merge and fairness', () => {
  const a = staff('a', allWeek('09:00', '10:00'));
  const b = staff('b', allWeek('09:30', '11:00'));
  it('merges distinct start times with candidates', () => {
    const merged = mergeAnyone(generateSlots(input({ staff: [a, b] })));
    expect(merged.map((m) => [localHm(m.startAt), m.candidateStaffIds])).toEqual([
      ['09:00', ['a']],
      ['09:30', ['a', 'b']],
      ['10:00', ['b']],
      ['10:30', ['b']],
    ]);
  });

  it('pickStaff chooses the fewest bookings, ties by staff id', () => {
    expect(pickStaff(['b', 'a'], { a: 3, b: 1 })).toBe('b');
    expect(pickStaff(['b', 'a'], { a: 2, b: 2 })).toBe('a');
    expect(pickStaff(['b', 'a'], {})).toBe('a');
    expect(pickStaff(['c'], { c: 9 })).toBe('c');
    expect(pickStaff([], {})).toBeNull();
  });
});

describe('DST - Asia/Beirut 2026 (rules computed, not assumed)', () => {
  const offsetAt = (iso: string) => DateTime.fromISO(iso, { zone: ZONE }).offset;
  const dayStartOffset = (ymd: string) => DateTime.fromISO(ymd, { zone: ZONE }).startOf('day').offset;

  // Find the transition days from the zone data: the last Sunday of March / October.
  function lastSunday(month: number): DateTime {
    let d = DateTime.fromObject({ year: 2026, month }, { zone: ZONE }).endOf('month').startOf('day');
    while (d.weekday !== 7) d = d.minus({ days: 1 });
    return d;
  }
  const spring = lastSunday(3);
  const autumn = lastSunday(10);

  it('zone data matches our reading: offset changes around those Sundays', () => {
    expect(spring.toISODate()).toBe('2026-03-29');
    expect(autumn.toISODate()).toBe('2026-10-25');
    expect(offsetAt('2026-03-28T12:00')).toBe(120);
    expect(offsetAt('2026-03-29T12:00')).toBe(180);
    expect(offsetAt('2026-10-24T12:00')).toBe(180);
    expect(offsetAt('2026-10-25T12:00')).toBe(120);
    // Beirut changes at local midnight: the spring Sunday starts at 01:00, offset +3.
    expect(spring.hour).toBe(1);
    expect(dayStartOffset(spring.toISODate()!)).toBe(180);
  });

  const day = (dt: DateTime) => dt.toISODate()!;
  const hours = allWeek('00:00', '24:00');
  const fullDay = staff('a', hours);
  const slotsOn = (ymd: string, step = 60, dur = 60, s = fullDay) =>
    generateSlots(input({ staff: [s], service: { durationMin: dur, bufferMin: 0 }, slotStepMin: step, range: { from: ymd, to: ymd } }));

  it('normal day: 24 hourly slots, wall times 00:00..23:00', () => {
    const slots = slotsOn('2026-03-28');
    expect(slots).toHaveLength(24);
    expect(starts(slots)[0]).toBe('00:00');
    expect(starts(slots)[23]).toBe('23:00');
  });

  it('spring day: nonexistent 00:00 yields no slot; day has 23 real hours', () => {
    const slots = slotsOn(day(spring));
    expect(slots).toHaveLength(23);
    expect(starts(slots)[0]).toBe('01:00');
    expect(starts(slots)).not.toContain('00:00');
    expect(slots[0]!.startAt.toISOString()).toBe('2026-03-28T22:00:00.000Z'); // 01:00 at +03
    expect(new Set(slots.map((s) => s.startAt.getTime())).size).toBe(23);
  });

  it('spring day with morning hours: 09:00 local is +03 (06:00Z)', () => {
    const s = staff('a', allWeek('09:00', '11:00'));
    const slots = slotsOn(day(spring), 30, 30, s);
    expect(starts(slots)).toEqual(['09:00', '09:30', '10:00', '10:30']);
    expect(slots[0]!.startAt.toISOString()).toBe('2026-03-29T06:00:00.000Z');
  });

  it('day before spring (+02) 09:00 is 07:00Z', () => {
    const s = staff('a', allWeek('09:00', '10:00'));
    expect(slotsOn('2026-03-28', 30, 30, s)[0]!.startAt.toISOString()).toBe('2026-03-28T07:00:00.000Z');
  });

  it('shift spanning the nonexistent hour moves forward, never emits a phantom wall time', () => {
    const s = staff('a', allWeek('00:00', '03:00'));
    const slots = slotsOn(day(spring), 30, 30, s);
    expect(starts(slots)).toEqual(['01:00', '01:30', '02:00', '02:30']);
  });

  it('autumn day (24th, Saturday) night: repeated 23:00 hour gives two distinct UTC instants, no duplicates', () => {
    const slots = slotsOn('2026-10-24');
    const utc = slots.map((s) => s.startAt.getTime());
    expect(new Set(utc).size).toBe(utc.length);
    // Local 00:00 of the 25th is +02 and the 23:00 hour repeats: the 24th has 25 real hours,
    // but the working interval ends at local 24:00 of the 25th (+02), so 25 hourly starts.
    expect(slots).toHaveLength(25);
    const wall = starts(slots);
    expect(wall.filter((w) => w === '23:00')).toHaveLength(2);
    // strictly increasing, 1h apart
    for (let i = 1; i < utc.length; i++) expect(utc[i]! - utc[i - 1]!).toBe(3_600_000);
    // first occurrence at +03 (20:00Z), second at +02 (21:00Z)
    expect(slots[23]!.startAt.toISOString()).toBe('2026-10-24T20:00:00.000Z');
    expect(slots[24]!.startAt.toISOString()).toBe('2026-10-24T21:00:00.000Z');
  });

  it('autumn Sunday (25th): normal 24 hourly slots from 00:00 (+02)', () => {
    const slots = slotsOn(day(autumn));
    expect(slots).toHaveLength(24);
    expect(slots[0]!.startAt.toISOString()).toBe('2026-10-24T22:00:00.000Z');
  });

  it('autumn: morning hours are +02 after the change and +03 before', () => {
    const s = staff('a', allWeek('09:00', '10:00'));
    expect(slotsOn('2026-10-24', 30, 30, s)[0]!.startAt.toISOString()).toBe('2026-10-24T06:00:00.000Z');
    expect(slotsOn('2026-10-25', 30, 30, s)[0]!.startAt.toISOString()).toBe('2026-10-25T07:00:00.000Z');
    expect(slotsOn('2026-10-26', 30, 30, s)[0]!.startAt.toISOString()).toBe('2026-10-26T07:00:00.000Z');
  });

  it('every slot across 2 weeks around both transitions has wall time inside working hours', () => {
    const s = staff('a', allWeek('09:00', '17:00'));
    for (const [from, to] of [
      ['2026-03-23', '2026-04-05'],
      ['2026-10-19', '2026-11-01'],
    ] as const) {
      const slots = generateSlots(input({ staff: [s], range: { from, to } }));
      expect(slots).toHaveLength(14 * 16);
      for (const sl of slots) {
        const hm = localHm(sl.startAt);
        expect(hm >= '09:00' && hm <= '16:30').toBe(true);
        expect(DateTime.fromJSDate(sl.startAt, { zone: ZONE }).minute % 30).toBe(0);
      }
    }
  });

  it('time off expressed in UTC subtracts correctly on a transition day', () => {
    const s = staff('a', allWeek('09:00', '11:00'), {
      timeOff: [{ startAt: new Date('2026-03-29T06:30:00Z'), endAt: new Date('2026-03-29T07:00:00Z') }], // 09:30-10:00 +03
    });
    expect(starts(slotsOn(day(spring), 30, 30, s))).toEqual(['09:00', '10:00', '10:30']);
  });
});

describe('input validation', () => {
  const a = staff('a', allWeek('09:00', '10:00'));

  it.each(['24:30', '09:99', '25:00', '9:5'])('rejects invalid working hours %j', (bad) => {
    const s = staff('a', [{ weekday: 1, startLocal: '09:00', endLocal: bad }]);
    expect(() => generateSlots(input({ staff: [s] }))).toThrow();
  });

  it.each([0, -15, 7, 25, 1.5, 1441])('rejects slotStepMin %j (must be a positive integer dividing 1440)', (step) => {
    expect(() => generateSlots(input({ staff: [a], slotStepMin: step }))).toThrow();
  });

  it('ignores inverted busy ranges instead of freeing time', () => {
    const s = staff('a', allWeek('09:00', '10:00'), {
      busy: [{ startAt: local('2026-06-01T09:30:00'), blockedUntil: local('2026-06-01T09:00:00') }],
    });
    expect(starts(generateSlots(input({ staff: [s] })))).toEqual(['09:00', '09:30']);
  });

  it('orders equal-time slots by staff id independent of locale', () => {
    const slots = generateSlots(input({ staff: [staff('b', allWeek('09:00', '09:30')), staff('B', allWeek('09:00', '09:30'))] }));
    expect(slots.map((x) => x.staffId)).toEqual(['B', 'b']);
  });
});
