import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { headerDayFor } from '@/lib/dashboard/viewedDay';

const BEIRUT = 'Asia/Beirut';
// 2026-11-06 10:00 in Beirut (UTC+2 in November).
const now = new Date('2026-11-06T08:00:00Z');

describe('headerDayFor', () => {
  it('follows the real today when nothing else is chosen', () => {
    const h = headerDayFor(null, BEIRUT, now);
    expect(h.day).toBe('2026-11-06');
    expect(h.isToday).toBe(true);
  });
  it('a past and a future day are not today, and keep the chosen date', () => {
    expect(headerDayFor('2026-11-04', BEIRUT, now)).toMatchObject({ day: '2026-11-04', isToday: false });
    expect(headerDayFor('2026-11-09', BEIRUT, now)).toMatchObject({ day: '2026-11-09', isToday: false });
  });
  it('choosing the real today explicitly is today', () => {
    expect(headerDayFor('2026-11-06', BEIRUT, now).isToday).toBe(true);
  });
  it('uses the business timezone, not the server one, for "today"', () => {
    // 22:30 UTC on the 6th is already the 7th in Beirut.
    const lateUtc = new Date('2026-11-06T22:30:00Z');
    expect(headerDayFor(null, BEIRUT, lateUtc).day).toBe('2026-11-07');
    expect(headerDayFor('2026-11-06', BEIRUT, lateUtc).isToday).toBe(false);
    expect(headerDayFor('2026-11-06', 'America/New_York', lateUtc).isToday).toBe(true);
  });
  it('midnight rollover: the same selection stops being today a minute later', () => {
    const before = new Date('2026-11-06T21:59:00Z'); // 23:59 Beirut
    const after = new Date('2026-11-06T22:01:00Z'); // 00:01 Beirut on the 7th
    expect(headerDayFor('2026-11-06', BEIRUT, before).isToday).toBe(true);
    expect(headerDayFor('2026-11-06', BEIRUT, after).isToday).toBe(false);
    expect(headerDayFor(null, BEIRUT, after).day).toBe('2026-11-07');
  });
  it('the instant to format is noon of that date in the business zone (never shifts to a neighbour day)', () => {
    for (const tz of [BEIRUT, 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      const { instant } = headerDayFor('2026-03-29', tz, now);
      expect(DateTime.fromJSDate(instant, { zone: tz }).toFormat('yyyy-MM-dd HH:mm')).toBe('2026-03-29 12:00');
    }
  });
});
