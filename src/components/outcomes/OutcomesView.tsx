'use client';

import { CircleCheck, PartyPopper } from 'lucide-react';
import Link from 'next/link';
import { useReducer, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { HeaderActions } from '@/components/app/HeaderActions';
import { NoShowBadge } from '@/components/app/NoShowBadge';
import { useAppSession } from '@/components/app/SessionContext';
import { EmptyState, LoadError } from '@/components/app/states';
import { useSummary } from '@/components/app/SummaryContext';
import { usePolling } from '@/components/app/usePolling';
import { useBookingFormat } from '@/components/booking/useBookingFormat';
import { Bidi, MetaLine, TimeRange } from '@/components/ui/Bidi';
import { Button, Spinner } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { getOutcomeQueue, markOutcome, type Outcome, type QueueItem } from '@/lib/api/outcomes';
import { useResource } from '@/lib/api/useResource';
import { dayRelation } from '@/lib/dashboard/agenda';
import { cn } from '@/lib/cn';
import {
  canMark,
  emptyMarks,
  justMarked,
  markReducer,
  outcomeFailure,
  pendingItems,
  remainingCount,
  type Entry,
} from '@/lib/outcomes/state';
import { chipTone } from '@/components/dashboard/apptStyles';
import { useClientLabel } from '@/components/app/useClientLabel';
import { isRepeatNoShow } from '@/lib/clientFlags';
import { OutcomeButtons } from './OutcomeButtons';
import { useFailureText } from './useFailureText';

const tone = { ATTENDED: 'attended', NO_SHOW: 'noShow', LATE_CANCEL: 'lateCancel' } as const;
const statusKey = { ATTENDED: 'attended', NO_SHOW: 'noShow', LATE_CANCEL: 'lateCancel' } as const;

/** "10:30 – 11:00 · Haircut · Karim", with the day in front when it was not today. */
function When({ item, timezone }: { item: QueueItem; timezone: string }) {
  const t = useTranslations('app.outcomes');
  const f = useBookingFormat(timezone);
  const relation = dayRelation(item.startAt, timezone);
  const day = relation === 'today' ? null : relation === 'tomorrow' ? t('tomorrow') : f.day(item.startAt);
  return (
    <MetaLine
      items={[
        day,
        <TimeRange key="r" start={f.time(item.startAt)} end={f.time(item.endAt)} />,
        <Bidi key="s">{item.service.name}</Bidi>,
        <Bidi key="p">{item.staff.displayName}</Bidi>,
      ]}
    />
  );
}

function QueueCard({
  item,
  entry,
  timezone,
  onPick,
}: {
  item: QueueItem;
  entry?: Entry;
  timezone: string;
  onPick: (item: QueueItem, outcome: Outcome) => void;
}) {
  const t = useTranslations('app.outcomes');
  const label = useClientLabel();
  const failure = useFailureText();
  return (
    <Card
      as="li"
      aria-busy={entry?.phase === 'saving' || undefined}
      className="flex flex-col gap-4 p-5 md:p-5"
    >
      <div className="flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-semibold">
          <Link
            href={`/app/appointments/${item.id}`}
            aria-label={t('openAria', { name: label(item.client) })}
            className="inline-flex min-h-11 items-center text-ink no-underline hover:underline"
          >
            {label(item.client)}
          </Link>
          {isRepeatNoShow(item.client.noShows) ? <NoShowBadge count={item.client.noShows} /> : null}
        </span>
        <span className="text-sm text-muted">
          <When item={item} timezone={timezone} />
        </span>
      </div>
      <OutcomeButtons
        name={label(item.client)}
        pending={entry?.phase === 'saving' ? entry.outcome : null}
        onPick={(o) => onPick(item, o)}
      />
      {entry?.error ? (
        <p role="alert" className="m-0 text-sm font-medium text-danger">
          {failure(entry.error)}
        </p>
      ) : null}
    </Card>
  );
}

function MarkedRow({
  entry,
  timezone,
  onPick,
}: {
  entry: Entry;
  timezone: string;
  onPick: (item: QueueItem, outcome: Outcome) => void;
}) {
  const t = useTranslations('app.outcomes');
  const label = useClientLabel();
  const ts = useTranslations('ui.status');
  const failure = useFailureText();
  const f = useBookingFormat(timezone);
  const [changing, setChanging] = useState(false);
  const outcome = entry.outcome!;
  const saving = entry.phase === 'saving';
  const { item } = entry;
  return (
    <li
      aria-busy={saving || undefined}
      className="flex flex-col gap-3 border-b border-row px-5 py-3 last:border-b-0"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 flex-[1_1_200px] text-[15px]">
          <MetaLine
            items={[
              <Link
                key="c"
                href={`/app/appointments/${item.id}`}
                className="inline-flex min-h-11 items-center font-semibold text-ink no-underline hover:underline"
              >
                <Bidi>{label(item.client)}</Bidi>
              </Link>,
              <TimeRange key="t" start={f.time(item.startAt)} />,
              <Bidi key="s">{item.service.name}</Bidi>,
              <Bidi key="p">{item.staff.displayName}</Bidi>,
            ]}
          />
        </span>
        <Chip tone={chipTone[tone[outcome]]} className="gap-1.5">
          {saving ? <Spinner className="size-3" /> : null}
          {ts(statusKey[outcome])}
        </Chip>
        <Button
          variant="ghost"
          size="md"
          aria-expanded={changing}
          disabled={saving}
          aria-label={t('changeAria', { name: label(item.client) })}
          onClick={() => setChanging((v) => !v)}
          className="px-3 text-sm font-medium"
        >
          {t('change')}
        </Button>
      </div>
      {entry.error ? (
        <p role="alert" className="m-0 text-sm font-medium text-danger">
          {failure(entry.error)}
        </p>
      ) : null}
      {changing && !saving ? (
        <OutcomeButtons
          name={label(item.client)}
          states={{ [outcome]: 'current' }}
          onPick={(o) => {
            setChanging(false);
            onPick(item, o);
          }}
        />
      ) : null}
    </li>
  );
}

function Skeletons() {
  const t = useTranslations('app.outcomes');
  return (
    <div
      className="grid gap-4 md:grid-cols-[repeat(auto-fill,minmax(340px,1fr))]"
      role="status"
      aria-busy="true"
      aria-label={t('loading')}
    >
      {[0, 1].map((i) => (
        <Skeleton key={i} className="h-[170px] rounded-card" />
      ))}
    </div>
  );
}

/** Board 4.4: ended appointments that still need Attended / No-show / Late cancel. */
export function OutcomesView() {
  const t = useTranslations('app.outcomes');
  const label = useClientLabel();
  const ts = useTranslations('ui.status');
  const { timezone } = useAppSession();
  const toast = useToast();
  const failureText = useFailureText();
  const { refresh, setOutcomesToMark } = useSummary();
  const [marks, dispatch] = useReducer(markReducer, emptyMarks);
  const busy = useRef(new Set<string>());

  const res = useResource((signal) => getOutcomeQueue(100, signal), 'queue');
  usePolling(res.reload);

  const items = res.data?.items ?? [];
  const left = res.data ? remainingCount(res.data.count, items, marks) : 0;
  const waiting = pendingItems(items, marks);
  const recent = justMarked(marks);

  const pick = async (item: QueueItem, outcome: Outcome) => {
    // One request per card at a time, even for a double tap that lands before React re-renders.
    if (busy.current.has(item.id) || !canMark(marks, item.id)) return;
    busy.current.add(item.id);
    dispatch({ type: 'tap', item, outcome });
    const wasWaiting = !marks.entries[item.id] || marks.entries[item.id]!.phase === 'failed';
    // Functional update: two quick taps each take one off the current badge, not the same `left - 1`.
    if (wasWaiting) setOutcomesToMark((current) => current - 1);
    try {
      await markOutcome(item.id, outcome);
      dispatch({ type: 'ok', id: item.id, outcome });
      toast.show(t('marked', { name: label(item.client), outcome: ts(statusKey[outcome]) }));
    } catch (error) {
      const failure = outcomeFailure(error);
      dispatch({ type: 'fail', id: item.id, failure });
      toast.show(failureText(failure), 'error');
    } finally {
      busy.current.delete(item.id);
      refresh();
      res.reload();
    }
  };

  const counter = res.data ? (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        'rounded-btn px-3 py-1.5 text-sm font-semibold whitespace-nowrap',
        left > 0 ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success',
      )}
    >
      {left > 0 ? t('left', { count: left }) : t('allDone')}
    </span>
  ) : null;

  return (
    <>
      <HeaderActions>{counter}</HeaderActions>
      <p className="m-0 max-w-[760px] text-[15px] leading-normal text-muted">{t('intro')}</p>
      {res.error && !res.data ? (
        <LoadError error={res.error} onRetry={res.reload} />
      ) : !res.data ? (
        <Skeletons />
      ) : (
        <>
          {res.error ? (
            <p role="status" className="m-0 text-sm text-muted">
              {t('stale')}
            </p>
          ) : null}
          {waiting.length > 0 ? (
            <ul
              aria-label={t('listLabel')}
              className="m-0 grid list-none gap-4 p-0 md:grid-cols-[repeat(auto-fill,minmax(340px,1fr))]"
            >
              {waiting.map((item) => (
                <QueueCard
                  key={item.id}
                  item={item}
                  entry={marks.entries[item.id]}
                  timezone={timezone}
                  onPick={pick}
                />
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<PartyPopper size={22} />}
              title={t('emptyTitle')}
              body={t('emptyBody')}
              action={
                <Link
                  href="/app"
                  className="inline-flex h-11 items-center rounded-btn border border-line bg-surface px-[18px] text-[15px] font-semibold text-ink no-underline transition-colors duration-200 ease-out hover:bg-canvas"
                >
                  {t('backToToday')}
                </Link>
              }
            />
          )}
          {recent.length > 0 ? (
            <section aria-labelledby="just-marked" className="flex flex-col gap-3">
              <h2
                id="just-marked"
                className="m-0 mt-2 text-[15px] font-semibold tracking-[0.06em] text-muted uppercase"
              >
                <CircleCheck size={16} aria-hidden="true" className="me-2 inline align-[-3px]" />
                {t('justMarked')}
              </h2>
              <Card as="section" padding="none" size="sm" className="overflow-hidden">
                <ul className="m-0 list-none p-0">
                  {recent.map((entry) => (
                    <MarkedRow key={entry.item.id} entry={entry} timezone={timezone} onPick={pick} />
                  ))}
                </ul>
              </Card>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
