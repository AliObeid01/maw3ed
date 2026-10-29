import { describe, expect, it } from 'vitest';
import type { TodayAppointment } from '@/lib/api/dashboard';
import {
  apptTone,
  capCount,
  greetingFor,
  groupAgenda,
  shiftDay,
  todayIn,
} from '@/lib/dashboard/agenda';
import { blockBox, blockRows, calendarRange, hourMarks } from '@/lib/dashboard/calendar';

const TZ = 'Asia/Beirut';

function appt(
  id: string,
  startAt: string,
  durationMin: number,
  extra: Partial<TodayAppointment> = {},
  staffId = 'p1',
): TodayAppointment {
  return {
    id,
    startAt,
    endAt: new Date(Date.parse(startAt) + durationMin * 60_000).toISOString(),
    status: 'BOOKED',
    source: 'PUBLIC',
    service: { id: 's1', name: 'Haircut', durationMin },
    staff: { id: staffId, displayName: staffId },
    client: { id: 'c1', name: 'Maya', phone: '+96170000000', noShows: 0, repeatNoShow: false },
    confirmedAt: null,
    reminders: { whatsappPending: false },
    ...extra,
  };
}

// Beirut is UTC+3 in summer (EEST), UTC+2 in winter. 2026-10-29 is after the 25 Oct fall-back: UTC+2.
describe('groupAgenda', () => {
  it('groups by local hour in the business timezone and sorts by time', () => {
    const list = [
      appt('c', '2026-10-29T08:40:00Z', 30), // 10:40 local
      appt('a', '2026-10-29T07:00:00Z', 30), // 09:00 local
      appt('b', '2026-10-29T07:30:00Z', 30), // 09:30 local
    ];
    const groups = groupAgenda(list, TZ);
    expect(groups.map((g) => [g.hour, g.items.map((i) => i.id)])).toEqual([
      [9, ['a', 'b']],
      [10, ['c']],
    ]);
  });

  it('filters by staff and drops cancelled bookings', () => {
    const list = [
      appt('a', '2026-10-29T07:00:00Z', 30, {}, 'p1'),
      appt('b', '2026-10-29T07:00:00Z', 30, {}, 'p2'),
      appt('x', '2026-10-29T08:00:00Z', 30, { status: 'CANCELLED' }, 'p2'),
    ];
    expect(groupAgenda(list, TZ, 'p2').flatMap((g) => g.items.map((i) => i.id))).toEqual(['b']);
    expect(groupAgenda(list, TZ).flatMap((g) => g.items.map((i) => i.id))).toEqual(['a', 'b']);
  });

  it('uses the business zone, not UTC, to pick the hour (late evening crosses UTC midnight)', () => {
    const groups = groupAgenda([appt('a', '2026-10-29T21:30:00Z', 30)], TZ); // 23:30 local
    expect(groups[0]!.hour).toBe(23);
  });

  it('keeps the repeated hour of a DST fall-back day as two groups', () => {
    // Lebanon falls back on the last Sunday of October at 00:00 -> 23:00 (25 Oct 2026 is that Sunday... the
    // hour 23:00-24:00 on Sat 24 Oct happens twice).
    const first = appt('a', '2026-10-24T20:30:00Z', 30); // 23:30 EEST (UTC+3)
    const second = appt('b', '2026-10-24T21:30:00Z', 30); // 23:30 EET (UTC+2)
    const groups = groupAgenda([second, first], TZ);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.items[0]!.id)).toEqual(['a', 'b']);
    expect(groups.map((g) => g.hour)).toEqual([23, 23]);
  });
});

describe('apptTone', () => {
  it('tints by status, waitlist-sourced open bookings amber', () => {
    expect(apptTone({ status: 'BOOKED', source: 'PUBLIC' })).toBe('booked');
    expect(apptTone({ status: 'CONFIRMED', source: 'PUBLIC' })).toBe('confirmed');
    expect(apptTone({ status: 'ATTENDED', source: 'WAITLIST' })).toBe('attended');
    expect(apptTone({ status: 'NO_SHOW', source: 'PUBLIC' })).toBe('noShow');
    expect(apptTone({ status: 'BOOKED', source: 'WAITLIST' })).toBe('waitlist');
    expect(apptTone({ status: 'SOMETHING_NEW', source: 'PUBLIC' })).toBe('booked');
  });
});

describe('day helpers', () => {
  it('todayIn uses the business zone', () => {
    // 22:30 UTC on the 28th is already the 29th in Beirut.
    expect(todayIn(TZ, new Date('2026-10-28T22:30:00Z'))).toBe('2026-10-29');
    expect(todayIn('UTC', new Date('2026-10-28T22:30:00Z'))).toBe('2026-10-28');
  });
  it('shiftDay moves calendar days across month ends', () => {
    expect(shiftDay('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('greets by business-local hour', () => {
    expect(greetingFor(TZ, new Date('2026-10-29T06:00:00Z'))).toBe('morning'); // 08:00
    expect(greetingFor(TZ, new Date('2026-10-29T11:00:00Z'))).toBe('afternoon'); // 13:00
    expect(greetingFor(TZ, new Date('2026-10-29T17:00:00Z'))).toBe('evening'); // 19:00
  });
});

describe('capCount', () => {
  it('hides zero, shows 99+ above 99', () => {
    expect(capCount(0)).toBeNull();
    expect(capCount(-3)).toBeNull();
    expect(capCount(7)).toBe('7');
    expect(capCount(99)).toBe('99');
    expect(capCount(100)).toBe('99+');
  });
});

describe('calendar layout', () => {
  it('defaults to 9-17 on an empty day', () => {
    expect(calendarRange([], TZ)).toEqual({ startHour: 9, endHour: 17 });
  });

  it('covers earliest start to latest end, rounded out to whole hours', () => {
    const list = [
      appt('a', '2026-10-29T07:30:00Z', 30), // 09:30-10:00
      appt('b', '2026-10-29T14:10:00Z', 50), // 16:10-17:00
    ];
    expect(calendarRange(list, TZ)).toEqual({ startHour: 9, endHour: 17 });
    const late = [appt('c', '2026-10-29T15:00:00Z', 70)]; // 17:00-18:10
    expect(calendarRange(late, TZ)).toEqual({ startHour: 17, endHour: 19 });
  });

  it('ignores cancelled bookings when sizing the grid', () => {
    const list = [
      appt('a', '2026-10-29T07:00:00Z', 30),
      appt('x', '2026-10-29T17:00:00Z', 30, { status: 'CANCELLED' }),
    ];
    expect(calendarRange(list, TZ)).toEqual({ startHour: 9, endHour: 10 });
  });

  it('lists an hour mark per hour', () => {
    expect(hourMarks({ startHour: 9, endHour: 12 })).toEqual([9, 10, 11]);
  });

  it('positions blocks at 44 px per 30 min, including durations that are not multiples of 30', () => {
    const a = appt('a', '2026-10-29T07:00:00Z', 90); // 09:00, 90 min
    expect(blockBox(a, TZ, 9)).toMatchObject({ top: 0, height: 132, compact: false });
    const b = appt('b', '2026-10-29T08:15:00Z', 20); // 10:15, 20 min
    const box = blockBox(b, TZ, 9);
    expect(box.top).toBeCloseTo(110); // 75 min after 09:00
    expect(box.height).toBeCloseTo(29.33, 1);
    expect(box.compact).toBe(true);
  });

  it('rounds grid rows out to whole 30-minute rows', () => {
    expect(blockRows(appt('a', '2026-10-29T07:00:00Z', 90), TZ, 9)).toEqual({ rowStart: 1, rowSpan: 3 });
    // 10:15-10:35 touches the 10:00 and 10:30 rows
    expect(blockRows(appt('b', '2026-10-29T08:15:00Z', 20), TZ, 9)).toEqual({ rowStart: 3, rowSpan: 2 });
    // 45 min starting on the half hour: 2 rows
    expect(blockRows(appt('c', '2026-10-29T07:30:00Z', 45), TZ, 9)).toEqual({ rowStart: 2, rowSpan: 2 });
  });
});
