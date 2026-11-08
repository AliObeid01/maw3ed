import { describe, expect, it } from 'vitest';
import type { SavedBooking } from '@/lib/myBookings/storage';
import { formatWhen, splitBookings } from '@/lib/myBookings/viewModel';

const NOW = new Date('2026-11-04T08:00:00Z');
const e = (over: Partial<SavedBooking>): SavedBooking => ({
  token: 'token-001',
  slug: 'studio-nour',
  businessName: 'Studio Nour',
  serviceName: 'Haircut',
  staffName: 'Karim',
  startAt: '2026-11-06T08:30:00.000Z',
  endAt: '2026-11-06T09:00:00.000Z',
  timezone: 'Asia/Beirut',
  reference: null,
  savedAt: '2026-11-04T07:00:00.000Z',
  ...over,
});

describe('splitBookings', () => {
  it('splits by start instant: after now is upcoming, soonest first; before is past, latest first', () => {
    const list = [
      e({ token: 'later', startAt: '2026-11-20T08:00:00Z' }),
      e({ token: 'old', startAt: '2026-10-01T08:00:00Z' }),
      e({ token: 'soon', startAt: '2026-11-05T08:00:00Z' }),
      e({ token: 'recent', startAt: '2026-11-03T08:00:00Z' }),
    ];
    const { upcoming, past } = splitBookings(list, NOW);
    expect(upcoming.map((x) => x.token)).toEqual(['soon', 'later']);
    expect(past.map((x) => x.token)).toEqual(['recent', 'old']);
  });

  it('moves a booking out of Upcoming as the injected clock passes its start', () => {
    const list = [e({ token: 'token-soon', startAt: '2026-11-04T08:01:30Z', endAt: '2026-11-04T08:31:30Z' })];
    const before = new Date('2026-11-04T08:00:00Z');
    const during = new Date('2026-11-04T08:01:00Z'); // one tick later: still 30 s to go
    const after = new Date('2026-11-04T08:02:00Z'); // the next tick: it has started
    expect(splitBookings(list, before).upcoming).toHaveLength(1);
    expect(splitBookings(list, during).upcoming).toHaveLength(1);
    const late = splitBookings(list, after);
    expect(late.upcoming).toEqual([]);
    expect(late.past).toHaveLength(1);
  });

  it('an appointment starting exactly now is past (its link stops working at the start)', () => {
    const { upcoming, past } = splitBookings([e({ token: 'x', startAt: NOW.toISOString() })], NOW);
    expect(upcoming).toEqual([]);
    expect(past).toHaveLength(1);
  });

  it('compares instants, not local wall clocks, across zones', () => {
    // 09:30 in Beirut (UTC+2) is 07:30Z: before NOW (08:00Z) although 09:30 > 08:00 as plain text.
    const { upcoming, past } = splitBookings(
      [e({ token: 'z', startAt: '2026-11-04T07:30:00Z', timezone: 'Asia/Beirut' })],
      NOW,
    );
    expect(upcoming).toEqual([]);
    expect(past).toHaveLength(1);
  });

  it('an ended entry is past, unless pinned (the user is looking at it now)', () => {
    const list = [e({ token: 'c', ended: 'cancelled' })];
    expect(splitBookings(list, NOW).past).toHaveLength(1);
    const pinned = splitBookings(list, NOW, new Set(['c']));
    expect(pinned.upcoming).toHaveLength(1);
    expect(pinned.past).toHaveLength(0);
  });
});

describe('formatWhen', () => {
  it('shows weekday, date and 24-hour time in the BUSINESS zone with Latin digits', () => {
    const w = formatWhen('2026-11-06T08:30:00.000Z', '2026-11-06T09:00:00.000Z', 'Asia/Beirut', 'en');
    expect(w.day).toBe('Fri 6 Nov');
    expect(w.range).toBe('10:30 – 11:00');
    expect(
      formatWhen('2026-11-06T08:30:00.000Z', '2026-11-06T09:00:00.000Z', 'America/New_York', 'en').range,
    ).toBe('03:30 – 04:00');
  });

  it('keeps the same wall time on both sides of a DST change (Beirut, 28 Mar 2027)', () => {
    // 10:00 local on Sat 27 Mar is 08:00Z (UTC+2); on Sun 28 Mar it is 07:00Z (UTC+3).
    expect(formatWhen('2027-03-27T08:00:00Z', '2027-03-27T08:30:00Z', 'Asia/Beirut', 'en').range).toBe(
      '10:00 – 10:30',
    );
    const after = formatWhen('2027-03-28T07:00:00Z', '2027-03-28T07:30:00Z', 'Asia/Beirut', 'en');
    expect(after.range).toBe('10:00 – 10:30');
    expect(after.day).toBe('Sun 28 Mar');
  });

  it('gives the month and day number for the date tile in the business zone', () => {
    const w = formatWhen('2026-11-05T22:30:00Z', '2026-11-05T23:00:00Z', 'Asia/Beirut', 'en');
    expect(w.month).toBe('Nov');
    expect(w.dayOfMonth).toBe('6');
  });

  it('uses the business day, not the device day, near midnight', () => {
    expect(formatWhen('2026-11-05T22:30:00Z', '2026-11-05T23:00:00Z', 'Asia/Beirut', 'en').day).toBe(
      'Fri 6 Nov',
    );
  });

  it('Arabic uses Arabic words and Latin digits', () => {
    const w = formatWhen('2026-11-06T08:30:00.000Z', '2026-11-06T09:00:00.000Z', 'Asia/Beirut', 'ar');
    expect(w.day).toMatch(/\d/);
    expect(w.day).not.toMatch(/[٠-٩]/);
    expect(w.range).toBe('10:30 – 11:00');
  });
});
