import { describe, expect, it } from 'vitest';
import {
  baselineRate,
  changeVsBaseline,
  daysCovered,
  noShowRate,
  round1,
  validateBaseline,
  weekWindows,
  weeklyCounts,
  type ReportRow,
} from '@/server/domain/pilotMetrics';

const TZ = 'Asia/Beirut';
const row = (
  iso: string,
  status: string,
  cancelledVia: ReportRow['cancelledVia'] = null,
): ReportRow => ({
  startAt: new Date(iso),
  status,
  cancelledVia,
  source: 'PUBLIC',
});

describe('rates', () => {
  it('no-shows over attended + no-shows', () => {
    expect(noShowRate(9, 1)).toBeCloseTo(10);
    expect(noShowRate(0, 3)).toBe(100);
  });
  it('is null for a zero denominator', () => {
    expect(noShowRate(0, 0)).toBeNull();
    expect(baselineRate(0, 0)).toBeNull();
  });
  it('baseline rate is no-shows over appointments', () => {
    expect(baselineRate(200, 30)).toBe(15);
  });
  it('change in points and relative percent', () => {
    expect(changeVsBaseline(7.5, 15)).toEqual({ changePoints: -7.5, changeRelativePct: -50 });
  });
  it('relative change is null when the baseline rate is 0, points still reported', () => {
    expect(changeVsBaseline(4, 0)).toEqual({ changePoints: 4, changeRelativePct: null });
  });
  it('is null when either side is unknown', () => {
    expect(changeVsBaseline(null, 10)).toEqual({ changePoints: null, changeRelativePct: null });
    expect(changeVsBaseline(10, null)).toEqual({ changePoints: null, changeRelativePct: null });
  });
  it('rounds to one decimal only when asked', () => {
    expect(round1(12.345)).toBe(12.3);
    expect(round1(12.35)).toBe(12.4);
    expect(noShowRate(2, 1)).toBeCloseTo(33.3333333, 5);
  });
});

describe('week windows (Monday start, business timezone)', () => {
  it('ends with the week containing now, oldest first', () => {
    // Wed 4 Nov 2026 10:00 Beirut
    const w = weekWindows(new Date('2026-11-04T08:00:00Z'), TZ, 3);
    expect(w.map((x) => x.weekStart)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
  });
  it('Sunday late evening local still belongs to the week that is ending', () => {
    // Sun 1 Nov 23:30 Beirut (UTC+2) = 21:30Z
    const w = weekWindows(new Date('2026-11-01T21:30:00Z'), TZ, 1);
    expect(w[0]!.weekStart).toBe('2026-10-26');
  });
  it('the DST week (clocks go back on 25 Oct 2026) is 169 hours and buckets by local time', () => {
    const w = weekWindows(new Date('2026-11-04T08:00:00Z'), TZ, 3);
    const dst = w[0]!;
    expect((dst.endUtc.getTime() - dst.startUtc.getTime()) / 3_600_000).toBe(169);
    expect(dst.startUtc.toISOString()).toBe('2026-10-18T21:00:00.000Z'); // Mon 19 Oct 00:00 at UTC+3
    expect(dst.endUtc.toISOString()).toBe('2026-10-25T22:00:00.000Z'); // Mon 26 Oct 00:00 at UTC+2
    const rows = [
      row('2026-10-25T21:30:00Z', 'ATTENDED'), // Sun 25 Oct 23:30 local: DST week
      row('2026-10-25T22:30:00Z', 'NO_SHOW'), // Mon 26 Oct 00:30 local: next week
    ];
    const weekly = weeklyCounts(rows, w);
    expect(weekly[0]).toMatchObject({ weekStart: '2026-10-19', attended: 1, noShows: 0 });
    expect(weekly[1]).toMatchObject({ weekStart: '2026-10-26', attended: 0, noShows: 1 });
  });
});

describe('weeklyCounts', () => {
  it('excludes CANCELLED, counts LATE_CANCEL separately and keeps it out of the rate', () => {
    const w = weekWindows(new Date('2026-11-04T08:00:00Z'), TZ, 1);
    const rows = [
      row('2026-11-02T08:00:00Z', 'ATTENDED'),
      row('2026-11-02T09:00:00Z', 'ATTENDED'),
      row('2026-11-02T10:00:00Z', 'ATTENDED'),
      row('2026-11-03T08:00:00Z', 'NO_SHOW'),
      row('2026-11-03T09:00:00Z', 'LATE_CANCEL', 'LINK'),
      row('2026-11-03T10:00:00Z', 'CANCELLED', 'LINK'),
      row('2026-11-03T11:00:00Z', 'CONFIRMED'),
    ];
    const [week] = weeklyCounts(rows, w);
    expect(week).toMatchObject({ appointments: 6, attended: 3, noShows: 1, lateCancels: 1 });
    expect(week!.noShowRate).toBe(25);
  });
  it('a week with no marked outcomes has a null rate', () => {
    const w = weekWindows(new Date('2026-11-04T08:00:00Z'), TZ, 1);
    expect(weeklyCounts([row('2026-11-02T08:00:00Z', 'BOOKED')], w)[0]!.noShowRate).toBeNull();
  });
});

describe('validateBaseline', () => {
  const ok = {
    fromDate: '2026-10-01',
    toDate: '2026-10-31',
    appointments: 100,
    noShows: 15,
    lateCancels: 3,
  };
  const today = '2026-11-04';
  it('accepts a valid baseline, including exactly 31 days and ending today', () => {
    expect(validateBaseline(ok, today)).toEqual({});
    expect(
      validateBaseline({ ...ok, fromDate: '2026-10-05', toDate: '2026-11-04' }, today),
    ).toEqual({});
  });
  it('rejects 32 days, reversed dates, the future and noShows above appointments', () => {
    expect(
      validateBaseline({ ...ok, fromDate: '2026-10-01', toDate: '2026-11-01' }, today),
    ).toHaveProperty('toDate');
    expect(
      validateBaseline({ ...ok, fromDate: '2026-10-10', toDate: '2026-10-09' }, today),
    ).toHaveProperty('toDate');
    expect(validateBaseline({ ...ok, toDate: '2026-11-05' }, today)).toHaveProperty('toDate');
    expect(validateBaseline({ ...ok, noShows: 101 }, today)).toHaveProperty('noShows');
  });
  it('rejects an impossible calendar date', () => {
    expect(validateBaseline({ ...ok, fromDate: '2026-02-31' }, today)).toHaveProperty('fromDate');
  });
});

describe('daysCovered', () => {
  it('is inclusive', () => {
    expect(daysCovered('2026-11-01', '2026-11-01')).toBe(1);
    expect(daysCovered('2026-11-01', '2026-11-28')).toBe(28);
    expect(daysCovered('2026-11-05', '2026-11-01')).toBe(0);
  });
});
