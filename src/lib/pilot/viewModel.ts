import type { PilotReport } from '@/lib/api/pilot';

export const DASH = '—';

const round1 = (n: number) => Math.round(n * 10) / 10;

/** "9.2%", "64%", "—" for null. Whole numbers drop the decimal, as on the board. Wrap in `<bdi dir="ltr">`. */
export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  const r = round1(value);
  return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)}%`;
}

/** Plain number for counts, "—" for null. */
export const formatCount = (value: number | null): string => (value === null ? DASH : String(value));

export type ChangeView =
  | { direction: 'down' | 'up'; points: string; relative: string | null }
  | { direction: 'same' }
  | null;

/**
 * The headline change. Points are the absolute difference at 1 decimal; relative is whole percent (absent when
 * the baseline rate was 0). A difference that rounds to 0.0 points reads as "same", never as an arrow.
 */
export function changeView(
  changePoints: number | null,
  changeRelativePct: number | null,
): ChangeView {
  if (changePoints === null) return null;
  const points = round1(Math.abs(changePoints));
  if (points === 0) return { direction: 'same' };
  return {
    direction: changePoints < 0 ? 'down' : 'up',
    points: Number.isInteger(points) ? points.toFixed(0) : points.toFixed(1),
    relative: changeRelativePct === null ? null : String(Math.round(Math.abs(changeRelativePct))),
  };
}

export type RateSide = {
  /** Display rate, "—" without data. */
  rate: string;
  /** Raw counts shown next to the rate. */
  noShows: number;
  of: number;
  hasData: boolean;
};

export type PilotView = {
  daysCovered: number;
  pilot: RateSide;
  baseline: RateSide | null;
  change: ChangeView;
  /** 0-100 bar widths on a shared scale. */
  pilotBar: number;
  baselineBar: number;
  signals: {
    confirmRate: string;
    cancellationsViaLink: string;
    waitlistRefills: number;
    waitlistSlotsOffered: number;
    waitlistRefillRate: string;
    hasWaitlist: boolean;
  };
};

/** Bar width in percent of `scaleMax`, clamped to 0-100. */
export function barPercent(rate: number | null, scaleMax: number): number {
  if (rate === null || scaleMax <= 0) return 0;
  return Math.min(100, Math.max(0, (rate / scaleMax) * 100));
}

/** Smallest "nice" axis maximum at or above `value`: multiples of 5 up to 20, then of 10; never below 10. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 10) return 10;
  const step = value <= 20 ? 5 : 10;
  return Math.ceil(value / step) * step;
}

export function buildPilotView(report: PilotReport): PilotView {
  const { pilot, baseline, signals } = report;
  const heldOrMissed = pilot.attended + pilot.noShows;
  const scaleMax = niceMax(Math.max(pilot.noShowRate ?? 0, pilot.baselineRate ?? 0) * 1.25);
  return {
    daysCovered: pilot.daysCovered,
    pilot: {
      rate: formatPercent(pilot.noShowRate),
      noShows: pilot.noShows,
      of: heldOrMissed,
      hasData: pilot.noShowRate !== null,
    },
    baseline: baseline
      ? {
          rate: formatPercent(pilot.baselineRate),
          noShows: baseline.noShows,
          of: baseline.appointments,
          hasData: pilot.baselineRate !== null,
        }
      : null,
    change: changeView(pilot.changePoints, pilot.changeRelativePct),
    pilotBar: barPercent(pilot.noShowRate, scaleMax),
    baselineBar: barPercent(pilot.baselineRate, scaleMax),
    signals: {
      confirmRate: formatPercent(signals.confirmRate),
      cancellationsViaLink: formatCount(signals.cancellationsViaLink),
      waitlistRefills: signals.waitlistRefills,
      waitlistSlotsOffered: signals.waitlistSlotsOffered,
      waitlistRefillRate: formatPercent(signals.waitlistRefillRate),
      hasWaitlist: signals.waitlistSlotsOffered > 0,
    },
  };
}

// ---- Weekly chart -----------------------------------------------------------------------------------

export type WeekBar = {
  weekStart: string;
  rate: number | null;
  /** Bar height in percent of the axis, 0 when there is no rate. */
  heightPct: number;
  label: string;
  noShows: number;
  of: number;
  /** Show the week label under this bar (thinned out when there are many weeks). */
  showLabel: boolean;
};

export type WeeklyChart = {
  axisMax: number;
  ticks: number[];
  baselineRate: number | null;
  /** Baseline line position, percent from the bottom. */
  baselinePct: number | null;
  weeks: WeekBar[];
  hasData: boolean;
};

/** Label every week up to 6 columns, then every 2nd (up to 12), then every 3rd: keeps 360 px readable. */
export function labelEvery(count: number): number {
  if (count <= 6) return 1;
  if (count <= 12) return 2;
  return 3;
}

export function buildWeeklyChart(report: PilotReport): WeeklyChart {
  const rates = report.weekly.map((w) => w.noShowRate);
  const baselineRate = report.pilot.baselineRate;
  const highest = Math.max(0, baselineRate ?? 0, ...rates.map((r) => r ?? 0));
  const axisMax = niceMax(highest);
  const every = labelEvery(report.weekly.length);
  return {
    axisMax,
    ticks: [0, axisMax / 2, axisMax],
    baselineRate,
    baselinePct: baselineRate === null ? null : barPercent(baselineRate, axisMax),
    weeks: report.weekly.map((w, i) => ({
      weekStart: w.weekStart,
      rate: w.noShowRate,
      heightPct: barPercent(w.noShowRate, axisMax),
      label: formatPercent(w.noShowRate),
      noShows: w.noShows,
      of: w.attended + w.noShows,
      showLabel: i % every === 0,
    })),
    hasData: rates.some((r) => r !== null),
  };
}
