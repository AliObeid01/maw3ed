'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { useBookingFormat } from '@/components/booking/useBookingFormat';
import type { PilotReport } from '@/lib/api/pilot';
import { buildWeeklyChart, formatPercent } from '@/lib/pilot/viewModel';

const PLOT_H = 'h-44';

/**
 * Weekly no-show rate as bars against the baseline line. Colour is never the only cue: every bar carries its value
 * (up to 8 weeks), the baseline is a dashed line with a text label and legend, and a table below has all the numbers.
 */
export function WeeklyChart({ report, timezone }: { report: PilotReport; timezone: string }) {
  const t = useTranslations('app.pilot.chart');
  const f = useBookingFormat(timezone);
  const chart = buildWeeklyChart(report);
  const captionId = useId();
  const showValues = chart.weeks.length <= 8;

  if (chart.weeks.length === 0 || !chart.hasData) {
    return <p className="m-0 py-6 text-center text-sm text-muted">{t('empty')}</p>;
  }

  const legendBaseline = t.rich('legendBaseline', {
    rate: formatPercent(chart.baselineRate),
    num: (chunks) => <bdi dir="ltr">{chunks}</bdi>,
  });
  const summary = t('summary', {
    count: chart.weeks.length,
    baseline: chart.baselineRate === null ? t('noBaseline') : formatPercent(chart.baselineRate),
  });

  return (
    <div className="flex flex-col gap-3">
      <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-[13px] text-muted">
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-3 w-3 rounded-[3px] bg-brand" />
          {t('legendRate')}
        </li>
        {chart.baselinePct !== null ? (
          <li className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-0 w-5 border-t-2 border-dashed border-warning"
            />
            {legendBaseline}
          </li>
        ) : null}
        {chart.hasGaps ? (
          <li className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-3 rounded-t-[3px] border border-dashed border-muted bg-[repeating-linear-gradient(135deg,transparent_0_3px,rgb(98_105_103/0.35)_3px_4px)]"
            />
            {t('legendNoData')}
          </li>
        ) : null}
      </ul>

      <div role="img" aria-label={summary} aria-describedby={captionId} className="m-0 flex flex-col gap-1.5">
        <div className="flex gap-2" dir="ltr">
          <div
            aria-hidden="true"
            className={`flex ${PLOT_H} w-9 shrink-0 flex-col-reverse justify-between text-end text-[11px] leading-none text-muted tabular-nums`}
          >
            {chart.ticks.map((tick) => (
              <span key={tick}>{tick}%</span>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div aria-hidden="true" className={`relative ${PLOT_H} border-b border-s border-line`}>
              {[50, 100].map((pct) => (
                <span
                  key={pct}
                  className="absolute inset-x-0 border-t border-row"
                  style={{ bottom: `${pct}%` }}
                />
              ))}
              <div className="absolute inset-0 flex items-end gap-1.5 px-1.5">
                {chart.weeks.map((w) => (
                  <div key={w.weekStart} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
                    {showValues ? (
                      <span className="mb-0.5 text-[11px] leading-none font-semibold text-ink tabular-nums">
                        {w.label}
                      </span>
                    ) : null}
                    {w.noData ? (
                      // No marked outcomes that week: a hatched stub, never a 0% bar.
                      <span
                        data-testid="no-data-week"
                        className="h-2 w-full max-w-9 rounded-t-md border border-dashed border-muted bg-[repeating-linear-gradient(135deg,transparent_0_3px,rgb(98_105_103/0.35)_3px_4px)]"
                      />
                    ) : (
                      <span
                        className="w-full max-w-9 rounded-t-md bg-brand transition-[height] duration-200 ease-out"
                        style={{ height: `${w.heightPct}%` }}
                      />
                    )}
                  </div>
                ))}
              </div>
              {chart.baselinePct !== null ? (
                <span
                  className="absolute inset-x-0 border-t-2 border-dashed border-warning"
                  style={{ bottom: `${chart.baselinePct}%` }}
                />
              ) : null}
            </div>
            <div aria-hidden="true" className="flex gap-1.5 px-1.5 pt-1.5">
              {chart.weeks.map((w) => (
                <span
                  key={w.weekStart}
                  className="min-w-0 flex-1 text-center text-[11px] whitespace-nowrap text-muted tabular-nums"
                >
                  {w.showLabel ? f.dayMonth(w.weekStart) : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
        <span id={captionId} className="sr-only">
          {t('caption')}
        </span>
      </div>

      <details className="group rounded-input border border-line bg-surface">
        <summary className="flex min-h-11 cursor-pointer items-center px-3.5 text-sm font-medium text-brand">
          {t('showTable')}
        </summary>
        <div className="overflow-x-auto px-3.5 pb-3">
          <table className="w-full min-w-[300px] border-collapse text-start text-sm">
            <caption className="sr-only">{t('caption')}</caption>
            <thead>
              <tr className="text-[13px] text-muted">
                <th scope="col" className="py-2 pe-3 text-start font-semibold">
                  {t('col.week')}
                </th>
                <th scope="col" className="py-2 pe-3 text-end font-semibold">
                  {t('col.noShows')}
                </th>
                <th scope="col" className="py-2 pe-3 text-end font-semibold">
                  {t('col.held')}
                </th>
                <th scope="col" className="py-2 text-end font-semibold">
                  {t('col.rate')}
                </th>
              </tr>
            </thead>
            <tbody>
              {chart.weeks.map((w) => (
                <tr key={w.weekStart} className="border-t border-row">
                  <th scope="row" className="py-2 pe-3 text-start font-medium">
                    {f.dayMonth(w.weekStart)}
                  </th>
                  <td className="py-2 pe-3 text-end tabular-nums">{w.noShows}</td>
                  <td className="py-2 pe-3 text-end tabular-nums">{w.of}</td>
                  <td className="py-2 text-end font-semibold tabular-nums">
                    <bdi dir="ltr">{w.label}</bdi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
