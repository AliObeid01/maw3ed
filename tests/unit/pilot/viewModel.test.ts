import { describe, expect, it } from 'vitest';
import type { PilotReport } from '@/lib/api/pilot';
import {
  barPercent,
  buildPilotView,
  buildWeeklyChart,
  changeView,
  formatPercent,
  labelEvery,
  niceMax,
  relativeText,
  addDays,
} from '@/lib/pilot/viewModel';

const report = (over: Partial<PilotReport['pilot']> = {}, weekly: PilotReport['weekly'] = []): PilotReport => ({
  baseline: { fromDate: '2026-10-01', toDate: '2026-10-14', appointments: 78, noShows: 14, lateCancels: 3 },
  pilot: {
    fromDate: '2026-10-15',
    toDate: '2026-10-28',
    daysCovered: 14,
    appointments: 80,
    attended: 69,
    noShows: 7,
    lateCancels: 4,
    noShowRate: 9.2,
    baselineRate: 17.9,
    changePoints: -8.7,
    changeRelativePct: -48.6,
    ...over,
  },
  weekly,
  signals: {
    confirmRate: 64,
    cancellationsViaLink: 9,
    waitlistSlotsOffered: 7,
    waitlistRefills: 5,
    waitlistRefillRate: 71.4,
  },
});
const week = (weekStart: string, rate: number | null, attended = 10, noShows = 1) => ({
  weekStart,
  appointments: attended + noShows,
  attended,
  noShows,
  lateCancels: 0,
  noShowRate: rate,
});

describe('formatPercent', () => {
  it('rounds to one decimal, drops a zero decimal, and shows a dash for null', () => {
    expect(formatPercent(9.2)).toBe('9.2%');
    expect(formatPercent(64)).toBe('64%');
    expect(formatPercent(9.249)).toBe('9.2%');
    expect(formatPercent(9.25)).toBe('9.3%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(Number.NaN)).toBe('—');
  });
});

describe('changeView', () => {
  it('lower: absolute points and whole relative percent', () => {
    expect(changeView(-8.7, -48.6)).toEqual({ direction: 'down', points: '8.7', relative: '49' });
  });
  it('higher is not shown as an improvement', () => {
    expect(changeView(3, 20)).toEqual({ direction: 'up', points: '3', relative: '20' });
  });
  it('no relative change when the baseline rate was 0', () => {
    expect(changeView(5, null)).toEqual({ direction: 'up', points: '5', relative: null });
  });
  it('a change that rounds to zero reads as the same', () => {
    expect(changeView(0.04, 1)).toEqual({ direction: 'same' });
    expect(changeView(0, null)).toEqual({ direction: 'same' });
  });
  it('null without a baseline or data', () => {
    expect(changeView(null, null)).toBeNull();
  });
});

describe('relativeText', () => {
  it('whole percent from 1%, one decimal below, omitted when it would read 0%', () => {
    expect(relativeText(-48.6)).toBe('49');
    expect(relativeText(1)).toBe('1');
    expect(relativeText(0.6)).toBe('0.6');
    expect(relativeText(-0.34)).toBe('0.3');
    expect(relativeText(0.04)).toBeNull();
    expect(relativeText(null)).toBeNull();
  });
  it('never prints 0% next to non-zero points', () => {
    expect(changeView(0.1, 0.04)).toEqual({ direction: 'up', points: '0.1', relative: null });
    expect(changeView(0.1, 0.6)).toEqual({ direction: 'up', points: '0.1', relative: '0.6' });
  });
});

describe('unmarked appointments', () => {
  it('counts started appointments with no outcome, never below 0', () => {
    expect(buildPilotView(report({ appointments: 80 })).unmarked).toBe(0); // 69 + 7 + 4
    expect(buildPilotView(report({ appointments: 83 })).unmarked).toBe(3);
    expect(buildPilotView(report({ appointments: 10 })).unmarked).toBe(0);
  });
});

describe('weekly chart range and gaps', () => {
  it('runs from the first week to the end of the last week (weekStart + 6 days)', () => {
    const c = buildWeeklyChart(report({}, [week('2026-10-12', 5), week('2026-10-19', 5), week('2026-10-26', 5)]));
    expect(c.range).toEqual({ from: '2026-10-12', to: '2026-11-01' });
    expect(addDays('2026-10-26', 6)).toBe('2026-11-01');
    expect(addDays('2026-12-28', 6)).toBe('2027-01-03');
    expect(buildWeeklyChart(report({}, [])).range).toBeNull();
  });
  it('marks null weeks as no data (not 0%) at every length, and flags gaps for the legend', () => {
    for (const n of [4, 8, 12]) {
      const weekly = Array.from({ length: n }, (_, i) => week(`2026-0${(i % 9) + 1}-01`, i === 2 ? null : 5));
      const c = buildWeeklyChart(report({}, weekly));
      expect(c.weeks.filter((w) => w.noData)).toHaveLength(1);
      expect(c.weeks[2]).toMatchObject({ noData: true, rate: null, heightPct: 0, label: '—' });
      expect(c.weeks[0]!.noData).toBe(false);
      expect(c.hasGaps).toBe(true);
    }
    expect(buildWeeklyChart(report({}, [week('2026-10-12', 0, 5, 0)])).weeks[0]).toMatchObject({ noData: false, rate: 0, label: '0%' });
    expect(buildWeeklyChart(report({}, [week('2026-10-12', 5)])).hasGaps).toBe(false);
  });
});

describe('buildPilotView', () => {
  it('pairs every rate with its raw counts', () => {
    const v = buildPilotView(report());
    expect(v.pilot).toEqual({ rate: '9.2%', noShows: 7, of: 76, hasData: true });
    expect(v.baseline).toEqual({ rate: '17.9%', noShows: 14, of: 78, hasData: true });
    expect(v.pilotBar).toBeLessThan(v.baselineBar);
    expect(v.signals).toMatchObject({ confirmRate: '64%', waitlistRefillRate: '71.4%', hasWaitlist: true });
  });
  it('handles nulls: no marked outcomes, no baseline, nothing offered', () => {
    const r = report({ noShowRate: null, baselineRate: null, changePoints: null, changeRelativePct: null });
    r.baseline = null;
    r.signals = { confirmRate: null, cancellationsViaLink: 0, waitlistSlotsOffered: 0, waitlistRefills: 0, waitlistRefillRate: null };
    const v = buildPilotView(r);
    expect(v.pilot).toMatchObject({ rate: '—', hasData: false });
    expect(v.baseline).toBeNull();
    expect(v.change).toBeNull();
    expect(v.pilotBar).toBe(0);
    expect(v.signals).toMatchObject({ confirmRate: '—', waitlistRefillRate: '—', hasWaitlist: false });
  });
});

describe('scale math', () => {
  it('niceMax steps by 5 up to 20, then 10, with a floor of 10', () => {
    expect(niceMax(0)).toBe(10);
    expect(niceMax(10)).toBe(10);
    expect(niceMax(10.1)).toBe(15);
    expect(niceMax(17.9)).toBe(20);
    expect(niceMax(20.1)).toBe(30);
    expect(niceMax(43)).toBe(50);
    expect(niceMax(Number.NaN)).toBe(10);
  });
  it('barPercent clamps and treats null as empty', () => {
    expect(barPercent(5, 20)).toBe(25);
    expect(barPercent(30, 20)).toBe(100);
    expect(barPercent(null, 20)).toBe(0);
    expect(barPercent(5, 0)).toBe(0);
  });
  it('labelEvery thins labels as columns grow', () => {
    expect([4, 6, 8, 12, 13].map(labelEvery)).toEqual([1, 1, 2, 2, 3]);
  });
});

describe('buildWeeklyChart', () => {
  it('shares one axis between bars and the baseline line, with null weeks empty', () => {
    const c = buildWeeklyChart(
      report({ baselineRate: 17.9 }, [week('2026-10-12', 12), week('2026-10-19', null, 0, 0), week('2026-10-26', 4.5)]),
    );
    expect(c.axisMax).toBe(20);
    expect(c.ticks).toEqual([0, 10, 20]);
    expect(c.baselinePct).toBeCloseTo(89.5);
    expect(c.weeks.map((w) => w.heightPct)).toEqual([60, 0, 22.5]);
    expect(c.weeks[1]).toMatchObject({ rate: null, label: '—' });
    expect(c.weeks[0]).toMatchObject({ noShows: 1, of: 11, label: '12%' });
    expect(c.hasData).toBe(true);
  });
  it('the axis grows to fit a weekly rate above the baseline', () => {
    const c = buildWeeklyChart(report({ baselineRate: 5 }, [week('2026-10-12', 33)]));
    expect(c.axisMax).toBe(40);
  });
  it('no baseline: no line; no data at all: hasData false', () => {
    const r = report({ baselineRate: null }, [week('2026-10-12', null, 0, 0)]);
    const c = buildWeeklyChart(r);
    expect(c.baselinePct).toBeNull();
    expect(c.hasData).toBe(false);
    expect(c.axisMax).toBe(10);
  });
  it('thins week labels for 12 weeks', () => {
    const weekly = Array.from({ length: 12 }, (_, i) => week(`2026-0${(i % 9) + 1}-01`, 5));
    const c = buildWeeklyChart(report({}, weekly));
    expect(c.weeks.filter((w) => w.showLabel)).toHaveLength(6);
  });
});
