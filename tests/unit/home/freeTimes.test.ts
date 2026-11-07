import { describe, expect, it } from 'vitest';
import { dayLabel, formatFreeTime } from '@/lib/home/freeTimes';

describe('formatFreeTime', () => {
  it('formats HH:mm 24 h in the business zone, not the viewer zone', () => {
    // 08:30 UTC is 10:30 in Beirut (UTC+2 in November) and 03:30 in New York.
    expect(formatFreeTime('2026-11-05T08:30:00.000Z', 'Asia/Beirut')).toBe('10:30');
    expect(formatFreeTime('2026-11-05T08:30:00.000Z', 'America/New_York')).toBe('03:30');
  });

  it('pads and uses Latin digits', () => {
    expect(formatFreeTime('2026-11-05T05:05:00.000Z', 'Asia/Beirut')).toBe('07:05');
  });

  it('follows DST: the same UTC hour is a different local hour in summer', () => {
    expect(formatFreeTime('2026-07-05T08:30:00.000Z', 'Asia/Beirut')).toBe('11:30');
  });

  it('falls back to the default zone for an unknown zone', () => {
    expect(formatFreeTime('2026-11-05T08:30:00.000Z', 'Not/AZone')).toBe('10:30');
  });
});

describe('dayLabel', () => {
  const now = new Date('2026-11-04T08:00:00.000Z'); // Wed 4 Nov, 10:00 in Beirut

  it('says today and tomorrow by the BUSINESS calendar day', () => {
    expect(dayLabel('2026-11-04T15:00:00.000Z', 'Asia/Beirut', now, 'en').kind).toBe('today');
    expect(dayLabel('2026-11-05T08:00:00.000Z', 'Asia/Beirut', now, 'en').kind).toBe('tomorrow');
  });

  it('a business zone different from the viewer: 22:30 UTC is already tomorrow in Beirut', () => {
    const late = new Date('2026-11-04T21:30:00.000Z'); // 23:30 Wed in Beirut, still Wed in UTC
    expect(dayLabel('2026-11-04T22:30:00.000Z', 'Asia/Beirut', late, 'en').kind).toBe('tomorrow');
    expect(dayLabel('2026-11-04T22:30:00.000Z', 'UTC', late, 'en').kind).toBe('today');
  });

  it('gives a weekday and date further out, in the locale with Latin digits', () => {
    const en = dayLabel('2026-11-07T08:00:00.000Z', 'Asia/Beirut', now, 'en');
    expect(en).toEqual({ kind: 'date', text: 'Sat 7 Nov' });
    const ar = dayLabel('2026-11-07T08:00:00.000Z', 'Asia/Beirut', now, 'ar');
    expect(ar.kind).toBe('date');
    expect(ar.text).toMatch(/7/);
    expect(ar.text).not.toMatch(/[٠-٩]/);
  });

  it('handles the DST change day (clocks go back on 25 Oct 2026 in Beirut)', () => {
    // The 25th is 25 hours long. It is "tomorrow" from any time on the 24th and a plain date from the 23rd.
    const late24 = new Date('2026-10-24T20:30:00.000Z'); // 23:30 on the 24th (UTC+3 before the change)
    expect(dayLabel('2026-10-25T21:30:00.000Z', 'Asia/Beirut', late24, 'en').kind).toBe('tomorrow'); // 23:30 on the 25th (UTC+2)
    const early23 = new Date('2026-10-23T09:00:00.000Z');
    expect(dayLabel('2026-10-25T21:30:00.000Z', 'Asia/Beirut', early23, 'en').kind).toBe('date');
  });
});
