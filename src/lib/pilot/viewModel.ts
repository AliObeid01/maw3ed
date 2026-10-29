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
    relative: relativeText(changeRelativePct),
  };
}

/**
 * Relative change as text: whole percent from 1%, one decimal below 1%, and null (omitted) when it would read "0%"
 * next to a non-zero number of points or when the baseline rate was 0.
 */
export function relativeText(changeRelativePct: number | null): string | null {
  if (changeRelativePct === null) return null;
  const abs = Math.abs(changeRelativePct);
  if (abs >= 1) return String(Math.round(abs));
  const one = round1(abs);
  return one === 0 ? null : one.toFixed(1);
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
  /** Started appointments in the pilot that still have no outcome (booked or confirmed). */
  unmarked: number;
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
    unmarked: Math.max(0, pilot.appointments - pilot.attended - pilot.noShows - pilot.lateCancels),
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
  /** No marked outcomes that week: drawn as a "no data" marker, never as a 0% bar. */
  noData: boolean;
};

export type WeeklyChart = {
  axisMax: number;
  ticks: number[];
  baselineRate: number | null;
  /** Baseline line position, percent from the bottom. */
  baselinePct: number | null;
  weeks: WeekBar[];
  hasData: boolean;
  /** First Monday shown and the last day of the last week shown (weekStart + 6 days), `yyyy-MM-dd`; null without weeks. */
  range: { from: string; to: string } | null;
  /** Some weeks have no marked outcomes (the legend explains the marker). */
  hasGaps: boolean;
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
      noData: w.noShowRate === null,
    })),
    hasData: rates.some((r) => r !== null),
    range:
      report.weekly.length === 0
        ? null
        : {
            from: report.weekly[0]!.weekStart,
            to: addDays(report.weekly[report.weekly.length - 1]!.weekStart, 6),
          },
    hasGaps: rates.some((r) => r === null),
  };
}

/** Calendar-day arithmetic on a `yyyy-MM-dd` (UTC, so DST never shifts it). */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
