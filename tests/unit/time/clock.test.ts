import { describe, expect, it } from 'vitest';
import { clockOf, formatClock, formatLocalStamp } from '@/lib/time/clock';
import { formatLocal } from '@/server/i18n/emailRender';
import { localTime, slotTime } from '@/lib/booking/slots';

describe('formatClock: the one time-of-day formatter', () => {
  it('zero-pads the hour and the minute (24-hour)', () => {
    expect(formatClock('2026-11-04T06:05:00Z', 'Asia/Beirut')).toBe('08:05');
    expect(formatClock('2026-11-04T07:00:00Z', 'Asia/Beirut')).toBe('09:00');
    expect(formatClock('2026-11-04T22:30:00Z', 'UTC')).toBe('22:30');
    expect(formatClock('2026-11-04T22:00:00Z', 'Asia/Beirut')).toBe('00:00');
  });

  it('uses the business timezone, not the process one, including across DST', () => {
    // Beirut moved from UTC+3 to UTC+2 on 25 Oct 2026.
    expect(formatClock('2026-10-24T05:00:00Z', 'Asia/Beirut')).toBe('08:00');
    expect(formatClock('2026-10-26T05:00:00Z', 'Asia/Beirut')).toBe('07:00');
    expect(formatClock('2026-11-04T07:00:00Z', 'America/New_York')).toBe('02:00');
  });

  it('accepts a Date or epoch milliseconds and returns an empty string for an invalid instant', () => {
    const date = new Date('2026-11-04T07:00:00Z');
    expect(formatClock(date, 'Asia/Beirut')).toBe('09:00');
    expect(formatClock(date.getTime(), 'Asia/Beirut')).toBe('09:00');
    expect(formatClock('not a date', 'Asia/Beirut')).toBe('');
  });

  it('always yields Latin digits, even when the default locale is Arabic', () => {
    const out = formatClock('2026-11-04T07:05:00Z', 'Asia/Beirut');
    expect(out).toMatch(/^[0-9]{2}:[0-9]{2}$/);
    expect(clockOf(9, 0)).toBe('09:00');
    expect(clockOf(18)).toBe('18:00');
  });

  it('builds the export stamp on the same clock', () => {
    expect(formatLocalStamp('2026-11-04T07:05:00Z', 'Asia/Beirut')).toBe('2026-11-04 09:05');
  });
});

describe('every surface agrees with formatClock', () => {
  const iso = '2026-11-04T06:05:00Z'; // 08:05 in Beirut
  it('booking slot helpers and the e-mail formatter', () => {
    expect(localTime(iso, 'Asia/Beirut')).toBe('08:05');
    expect(slotTime(iso, 'Asia/Beirut')).toBe('08:05+02:00');
    expect(formatLocal(new Date(iso), 'Asia/Beirut', 'en').time).toBe('08:05');
    expect(formatLocal(new Date(iso), 'Asia/Beirut', 'ar').time).toBe('08:05');
  });
});
