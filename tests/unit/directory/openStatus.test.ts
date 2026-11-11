import { describe, expect, it } from 'vitest';
import { openStatus } from '@/server/domain/openStatus';

// Beirut is UTC+2 in winter (EET) and UTC+3 in summer (EEST). 2026-11-11 is a Wednesday (weekday 3).
const WED = 3;
const day = (startLocal: string, endLocal: string, weekday = WED) => ({ weekday, startLocal, endLocal });
const at = (iso: string) => new Date(iso);

describe('openStatus', () => {
  const hours = [day('09:00', '19:00')];

  it('is open with the closing time while inside an interval', () => {
    // 10:00 Beirut
    expect(openStatus(hours, 'Asia/Beirut', at('2026-11-11T08:00:00Z'))).toEqual({ open: true, until: '19:00' });
  });

  it('is open at the start and closed at the end (end is exclusive)', () => {
    expect(openStatus(hours, 'Asia/Beirut', at('2026-11-11T07:00:00Z'))).toEqual({ open: true, until: '19:00' });
    expect(openStatus(hours, 'Asia/Beirut', at('2026-11-11T17:00:00Z')).open).toBe(false);
  });

  it('is closed before opening and says when it opens', () => {
    // 07:30 Beirut
    expect(openStatus(hours, 'Asia/Beirut', at('2026-11-11T05:30:00Z'))).toEqual({ open: false, opensAt: '09:00' });
  });

  it('is closed after closing with no opening time (closed for the rest of today)', () => {
    // 20:00 Beirut
    expect(openStatus(hours, 'Asia/Beirut', at('2026-11-11T18:00:00Z'))).toEqual({ open: false });
  });

  it('handles a split shift: open, the gap and the second shift', () => {
    const split = [day('09:00', '13:00'), day('16:00', '20:00')];
    expect(openStatus(split, 'Asia/Beirut', at('2026-11-11T09:00:00Z'))).toEqual({ open: true, until: '13:00' }); // 11:00
    expect(openStatus(split, 'Asia/Beirut', at('2026-11-11T12:00:00Z'))).toEqual({ open: false, opensAt: '16:00' }); // 14:00
    expect(openStatus(split, 'Asia/Beirut', at('2026-11-11T15:00:00Z'))).toEqual({ open: true, until: '20:00' }); // 17:00
  });

  it('merges the hours of several staff into one union (overlap and touching intervals)', () => {
    const team = [day('09:00', '14:00'), day('12:00', '19:00'), day('19:00', '21:00')];
    expect(openStatus(team, 'Asia/Beirut', at('2026-11-11T08:00:00Z'))).toEqual({ open: true, until: '21:00' });
  });

  it('is closed with nothing to announce on a day without hours', () => {
    // Thursday 10:00 Beirut, hours only on Wednesday
    expect(openStatus(hours, 'Asia/Beirut', at('2026-11-12T08:00:00Z'))).toEqual({ open: false });
  });

  it('is closed when the business has no staff hours at all', () => {
    expect(openStatus([], 'Asia/Beirut', at('2026-11-11T08:00:00Z'))).toEqual({ open: false });
  });

  it('uses the business zone, not the server or viewer zone', () => {
    // 04:00Z is 23:00 (Tue 10th) in New York but 06:00 in Beirut: both before 09:00, but on different weekdays.
    const ny = [day('09:00', '17:00', 2)];
    expect(openStatus(ny, 'America/New_York', at('2026-11-10T18:00:00Z'))).toEqual({ open: true, until: '17:00' }); // 13:00 EST Tue
    expect(openStatus(ny, 'Asia/Beirut', at('2026-11-10T18:00:00Z'))).toEqual({ open: false }); // 20:00 Tue in Beirut
  });

  it('follows the local clock across a DST change', () => {
    // 2026-10-25 (Sunday, weekday 0): Beirut clocks go back from 04:00 to 03:00 (UTC+3 to UTC+2).
    const sun = [day('09:00', '17:00', 0)];
    expect(openStatus(sun, 'Asia/Beirut', at('2026-10-25T07:30:00Z'))).toEqual({ open: true, until: '17:00' }); // 09:30 local (UTC+2)
    expect(openStatus(sun, 'Asia/Beirut', at('2026-10-25T05:30:00Z'))).toEqual({ open: false, opensAt: '09:00' }); // 07:30 local
    // 14:30Z is 16:30 local (offset +2 after the change), still open.
    expect(openStatus(sun, 'Asia/Beirut', at('2026-10-25T14:30:00Z'))).toEqual({ open: true, until: '17:00' });
    expect(openStatus(sun, 'Asia/Beirut', at('2026-10-25T15:30:00Z')).open).toBe(false); // 17:30 local
  });

  it('a 24:00 closing with nothing after it is a real midnight close, written 00:00', () => {
    expect(openStatus([day('08:00', '24:00')], 'Asia/Beirut', at('2026-11-11T08:00:00Z'))).toEqual({ open: true, until: '00:00' });
  });

  // Changed on purpose (PR-19 review): 24:00 followed by a next-day 00:00 opening is continuous, so "until 00:00"
  // would be wrong; the real close time of the whole run is reported.
  it('is continuous across midnight: a 24:00 close and a next-day 00:00 opening merge into the real close', () => {
    const late = [day('18:00', '24:00', WED), day('00:00', '02:00', 4)];
    expect(openStatus(late, 'Asia/Beirut', at('2026-11-11T17:00:00Z'))).toEqual({ open: true, until: '02:00' }); // Wed 19:00
    // Thursday 01:00 is inside the second interval, which closes at 02:00.
    expect(openStatus(late, 'Asia/Beirut', at('2026-11-11T23:00:00Z'))).toEqual({ open: true, until: '02:00' });
  });

  it('chains several days, wraps Sunday to Monday, and omits until when it never closes', () => {
    const sunToMon = [day('20:00', '24:00', 0), day('00:00', '03:00', 1)];
    // Sunday 2026-11-08 21:00 Beirut
    expect(openStatus(sunToMon, 'Asia/Beirut', at('2026-11-08T19:00:00Z'))).toEqual({ open: true, until: '03:00' });
    const always = [0, 1, 2, 3, 4, 5, 6].map((w) => day('00:00', '24:00', w));
    expect(openStatus(always, 'Asia/Beirut', at('2026-11-11T08:00:00Z'))).toEqual({ open: true });
  });

  it('does not merge when the next day opens later than 00:00', () => {
    const gap = [day('18:00', '24:00', WED), day('08:00', '12:00', 4)];
    expect(openStatus(gap, 'Asia/Beirut', at('2026-11-11T17:00:00Z'))).toEqual({ open: true, until: '00:00' });
  });

  it('exposes only the open flag and two clock times (nothing private)', () => {
    const out = openStatus(hours, 'Asia/Beirut', at('2026-11-11T08:00:00Z'));
    expect(Object.keys(out).sort()).toEqual(['open', 'until']);
  });
});
