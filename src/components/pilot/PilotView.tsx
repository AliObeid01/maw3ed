'use client';

import { ArrowDown, ArrowUp, Download, Equal, Info } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { HeaderActions } from '@/components/app/HeaderActions';
import { useAppSession } from '@/components/app/SessionContext';
import { LoadError, OwnerOnly, useErrorMessage } from '@/components/app/states';
import { useBookingFormat } from '@/components/booking/useBookingFormat';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { getReport, REPORT_WEEKS, type PilotReport, type ReportWeeks } from '@/lib/api/pilot';
import { useResource } from '@/lib/api/useResource';
import { cn } from '@/lib/cn';
import { clampExportRange, fetchCsv, MAX_EXPORT_DAYS, saveBlob } from '@/lib/pilot/csv';
import {
  buildPilotView,
  buildWeeklyChart,
  DASH,
  type ChangeView,
  type PilotView as PilotViewModel,
  type RateSide,
} from '@/lib/pilot/viewModel';
import { BaselineForm } from './BaselineForm';
import { WeeklyChart } from './WeeklyChart';

function Ltr({ children }: { children: ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}

function ChangeChip({ change }: { change: ChangeView }) {
  const t = useTranslations('app.pilot.hero');
  if (!change) return null;
  const Icon = change.direction === 'down' ? ArrowDown : change.direction === 'up' ? ArrowUp : Equal;
  const text =
    change.direction === 'same'
      ? t('same')
      : // Only the numbers are LTR islands; the sentence keeps the page direction (Arabic reads right to left).
        t.rich(change.direction === 'down' ? 'lower' : 'higher', {
          points: change.points,
          count: Number(change.points),
          relative: change.relative ?? '',
          hasRelative: change.relative === null ? 'no' : 'yes',
          num: (chunks) => <bdi dir="ltr">{chunks}</bdi>,
        });
  return (
    <span className="inline-flex min-h-8 items-center gap-1.5 rounded-chip bg-cyan px-3 py-1 text-sm font-semibold text-ink">
      <Icon size={16} aria-hidden="true" className="shrink-0" />
      <span>{text}</span>
    </span>
  );
}

/** One horizontal bar with its label and raw counts (the counts are never left out). */
function RateBar({
  label,
  side,
  width,
  light,
}: {
  label: string;
  side: RateSide;
  width: number;
  light?: boolean;
}) {
  const t = useTranslations('app.pilot.hero');
  // Numbers are LTR islands inside a sentence that keeps the page direction.
  const counts = t.rich('counts', {
    noShows: side.noShows,
    of: side.of,
    num: (chunks) => <bdi dir="ltr">{chunks}</bdi>,
  });
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[15px]">
        <span className="font-medium">
          {label} · <Ltr>{side.rate}</Ltr>
        </span>
        <span className="text-hero-muted">{counts}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-pill bg-white/15" aria-hidden="true">
        <div
          className={cn('h-full rounded-pill transition-[width] duration-200 ease-out', light ? 'bg-white/60' : 'bg-cyan')}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function Hero({
  view,
  report,
  timezone,
}: {
  view: PilotViewModel;
  report: PilotReport;
  timezone: string;
}) {
  const t = useTranslations('app.pilot.hero');
  const locale = useLocale();
  const f = useBookingFormat(timezone);
  return (
    <section aria-labelledby="pilot-hero" className="bg-hero flex flex-col gap-4 rounded-card p-5 text-white md:p-6">
      <span
        id="pilot-hero"
        className="text-[13px] font-semibold tracking-[0.06em] text-hero-subtle uppercase"
      >
        {t('eyebrow', { from: f.dayMonth(report.pilot.fromDate) })}
      </span>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[48px] leading-none font-semibold tabular-nums md:text-[56px]">
          <Ltr>{view.pilot.rate}</Ltr>
        </span>
        <ChangeChip change={view.change} />
      </div>
      {!view.pilot.hasData ? (
        <p className="m-0 text-sm text-hero-muted">{t('noOutcomes')}</p>
      ) : null}
      {view.unmarked > 0 ? (
        <Link
          href="/app/outcomes"
          className="inline-flex min-h-11 items-center self-start rounded-btn bg-white/15 px-4 py-2 text-sm font-medium text-white no-underline transition-colors duration-200 ease-out hover:bg-white/25"
        >
          {t('unmarked', { count: view.unmarked })}
        </Link>
      ) : null}
      <div className="flex flex-col gap-3.5">
        <RateBar label={t('withMaw3ed')} side={view.pilot} width={view.pilotBar} />
        {view.baseline ? (
          <RateBar label={t('before')} side={view.baseline} width={view.baselineBar} light />
        ) : (
          <p className="m-0 text-sm text-hero-muted">{t('noBaseline')}</p>
        )}
      </div>
      <p className="m-0 text-[13px] leading-normal text-hero-muted">
        {locale === 'en' && report.rateDefinition ? report.rateDefinition : t('definition')}
      </p>
    </section>
  );
}

function SignalTile({
  value,
  label,
  note,
}: {
  value: ReactNode;
  label: string;
  note?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-tile border border-line bg-surface p-4">
      <span className="text-[28px] leading-tight font-semibold tabular-nums">{value}</span>
      <span className="text-sm text-ink">{label}</span>
      {note ? <span className="text-[13px] text-muted">{note}</span> : null}
    </div>
  );
}

function Signals({ view }: { view: PilotViewModel }) {
  const t = useTranslations('app.pilot.signals');
  const s = view.signals;
  return (
    <section aria-label={t('label')} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <SignalTile
        value={<Ltr>{s.confirmRate}</Ltr>}
        label={t('confirmed')}
        note={s.confirmRate === DASH ? t('noReminders') : t('confirmedNote')}
      />
      <SignalTile
        value={s.cancellationsViaLink}
        label={t('cancelledByLink')}
        note={t('cancelledByLinkNote')}
      />
      <SignalTile
        value={
          s.hasWaitlist ? (
            // The sentence follows the page direction; only the two numbers are LTR islands.
            t.rich('refilledValue', {
              refilled: s.waitlistRefills,
              offered: s.waitlistSlotsOffered,
              num: (chunks) => <bdi dir="ltr">{chunks}</bdi>,
            })
          ) : (
            DASH
          )
        }
        label={t('refilled')}
        note={
          s.hasWaitlist
            ? t.rich('refilledNote', {
                rate: s.waitlistRefillRate,
                num: (chunks) => <bdi dir="ltr">{chunks}</bdi>,
              })
            : t('noWaitlist')
        }
      />
    </section>
  );
}

function Skeletons() {
  const t = useTranslations('app.pilot');
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('loading')}
      className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start"
    >
      <div className="flex flex-col gap-4">
        <Skeleton className="h-[250px] rounded-card" />
        <Skeleton className="h-[96px] rounded-tile" />
        <Skeleton className="h-[260px] rounded-card" />
      </div>
      <Skeleton className="h-[380px] rounded-card-sm" />
    </div>
  );
}

function ExportButton({ report }: { report: PilotReport | undefined }) {
  const t = useTranslations('app.pilot');
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const range = report ? clampExportRange(report.pilot.fromDate, report.pilot.toDate) : null;
  const run = async () => {
    if (!report || !range || busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const { blob, filename } = await fetchCsv(range.from, range.to);
      saveBlob(blob, filename);
      toast.show(t('exported'));
    } catch (error) {
      toast.show(errorMessage(error), 'error');
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const hintId = 'export-hint';
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="secondary"
        loading={pending}
        disabled={!report}
        onClick={run}
        aria-describedby={range?.clamped ? hintId : undefined}
      >
        {pending ? null : <Download size={18} aria-hidden="true" />}
        {t('export')}
      </Button>
      {range?.clamped ? (
        <span id={hintId} className="max-w-[220px] text-end text-[12px] leading-tight text-muted">
          {t('exportClamped', { count: MAX_EXPORT_DAYS })}
        </span>
      ) : null}
    </div>
  );
}

function PilotContent() {
  const t = useTranslations('app.pilot');
  const { timezone } = useAppSession();
  const f = useBookingFormat(timezone);
  const [weeks, setWeeks] = useState<ReportWeeks>(4);
  const res = useResource((signal) => getReport(weeks, signal), `weeks:${weeks}`);
  // Keep showing the last report while another period loads, so the page (and a half-edited baseline) does not blink.
  const [shown, setShown] = useState<PilotReport>();
  if (res.data && res.data !== shown) setShown(res.data);
  const report = shown;
  const view = report ? buildPilotView(report) : null;
  const range = report ? buildWeeklyChart(report).range : null;
  // The control and the chart always describe the report on screen: after a failed switch it shows that report's period.
  const selected = (res.error && report ? report.weekly.length : weeks) as ReportWeeks;

  const baselineCard = report ? (
    <Card as="aside" size="sm" padding="compact" aria-labelledby="baseline-title" className="flex flex-col gap-3.5">
      <h2 id="baseline-title" className="m-0 text-lg font-semibold">
        {t('baseline.title')}
      </h2>
      {report.baseline ? null : <p className="m-0 text-sm text-muted">{t('baseline.empty')}</p>}
      <BaselineForm
        key={JSON.stringify(report.baseline)}
        baseline={report.baseline}
        definition={report.baselineDefinition}
        onSaved={res.reload}
      />
    </Card>
  ) : null;

  return (
    <>
      <HeaderActions>
        <ExportButton report={report} />
      </HeaderActions>
      {res.error && !report ? (
        <LoadError error={res.error} onRetry={res.reload} />
      ) : !report || !view ? (
        <Skeletons />
      ) : (
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-x-5">
          <div className="flex min-w-0 flex-col gap-4 lg:order-1">
            <Hero view={view} report={report} timezone={timezone} />
            <Signals view={view} />
            <Card as="section" aria-labelledby="weekly-title" className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <h2 id="weekly-title" className="m-0 text-lg font-semibold">
                    {t('chart.title')}
                  </h2>
                  {range ? (
                    <p className="m-0 text-sm text-muted">
                      {t('chart.range', {
                        count: report.weekly.length,
                        from: f.ymd(range.from),
                        to: f.ymd(range.to),
                      })}
                    </p>
                  ) : null}
                </div>
                <div className="w-full sm:w-[260px]">
                  <Segmented<ReportWeeks>
                    label={t('weeks.label')}
                    value={selected}
                    options={REPORT_WEEKS.map((w) => ({ value: w, label: t('weeks.option', { count: w }) }))}
                    onChange={(next) => {
                      setWeeks(next);
                      // Choosing the period that just failed to load asks again.
                      if (next === weeks && res.error) res.reload();
                    }}
                  />
                </div>
              </div>
              <div aria-busy={res.loading || undefined} className={cn(res.loading && 'opacity-60 transition-opacity')}>
                <WeeklyChart report={report} timezone={timezone} />
              </div>
            </Card>
            <p className="m-0 flex items-start gap-2.5 rounded-[18px] bg-divider p-4 text-sm leading-normal text-muted">
              <Info size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
              {t('smallNumbers')}
            </p>
            {res.error ? (
              <p role="status" className="m-0 text-sm text-muted">
                {t('stale', { count: report.weekly.length })}
              </p>
            ) : null}
          </div>
          {/* The metric band leads on phones too; the baseline form follows it. */}
          <div className="lg:order-2">{baselineCard}</div>
        </div>
      )}
    </>
  );
}

/** Board 4.8: baseline vs pilot no-show rate, owner only. Counts always sit next to the rates. */
export function PilotView() {
  return (
    <OwnerOnly>
      <PilotContent />
    </OwnerOnly>
  );
}
