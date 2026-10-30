'use client';

import { MetaLine } from '@/components/ui/Bidi';
import { ChevronRight, Search, SearchX, UserRound, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useReducer, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { NoShowBadge } from '@/components/app/NoShowBadge';
import { useAppSession } from '@/components/app/SessionContext';
import { EmptyState, LoadError } from '@/components/app/states';
import { useBookingFormat } from '@/components/booking/useBookingFormat';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { getClients, type ClientRow, type ClientSort } from '@/lib/api/outcomes';
import { createDebounced } from '@/lib/clients/debounce';
import { initialList, listReducer } from '@/lib/clients/state';
import { cn } from '@/lib/cn';
import { dayRelation } from '@/lib/dashboard/agenda';
import { formatPhone, initials } from '@/lib/dashboard/phone';
import { useClientLabel } from '@/components/app/useClientLabel';

export const SEARCH_DEBOUNCE_MS = 300;
const GRID = 'md:grid md:grid-cols-[1.6fr_1.3fr_0.6fr_0.8fr_0.9fr_1.2fr_20px] md:items-center md:gap-3';

/** Count pill as on the board: red for a repeat no-shower, amber for one, plain digit for zero. */
function CountPill({ value, tone }: { value: number; tone: 'danger' | 'warning' | 'none' }) {
  if (value <= 0 || tone === 'none') return <span>{value}</span>;
  return (
    <span
      className={cn(
        'inline-flex min-w-6 items-center justify-center rounded-pill px-2 py-0.5 text-[13px] font-semibold',
        tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning',
      )}
    >
      {value}
    </span>
  );
}

function ClientItem({ client, timezone }: { client: ClientRow; timezone: string }) {
  const label = useClientLabel();
  const name = label(client);
  const t = useTranslations('app.clients');
  const f = useBookingFormat(timezone);
  const last = client.lastVisitAt
    ? dayRelation(client.lastVisitAt, timezone) === 'today'
      ? t('today')
      : f.day(client.lastVisitAt)
    : null;
  return (
    <li className="border-b border-row last:border-b-0">
      <Link
        href={`/app/clients/${client.id}`}
        aria-label={t('openAria', { name })}
        className={cn(
          'flex min-h-[72px] flex-col gap-2 px-4 py-3.5 text-ink no-underline transition-colors duration-200 ease-out hover:bg-canvas md:min-h-[64px] md:px-[22px] md:py-3',
          GRID,
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-pill text-[13px] font-semibold',
              client.repeatNoShow ? 'bg-danger-soft text-danger' : 'bg-brand-avatar text-brand',
            )}
          >
            {initials(name)}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5 md:flex-row md:items-center md:gap-2">
            <span className="truncate font-semibold">{name}</span>
            {client.repeatNoShow ? (
              <NoShowBadge count={client.noShows} className="self-start md:self-auto" />
            ) : null}
            <span className="text-[13px] text-muted md:hidden">
              <bdi dir="ltr">{formatPhone(client.phone)}</bdi>
            </span>
          </span>
        </span>
        <span className="hidden text-[15px] text-muted md:block">
          <bdi dir="ltr">{formatPhone(client.phone)}</bdi>
        </span>
        {/* Phones: one summary line. md+: one column per number. */}
        <span className="text-[13px] text-muted md:hidden">
          <MetaLine
            items={[
              t('summary', {
                visits: client.attended,
                noShows: client.noShows,
                lateCancels: client.lateCancels,
              }),
              last ? <span className="whitespace-nowrap">{t('last', { day: last })}</span> : null,
            ]}
          />
        </span>
        <span className="hidden tabular-nums md:block">{client.attended}</span>
        <span className="hidden tabular-nums md:block">
          <CountPill
            value={client.noShows}
            tone={client.repeatNoShow ? 'danger' : client.noShows > 0 ? 'warning' : 'none'}
          />
        </span>
        <span className="hidden tabular-nums md:block">{client.lateCancels}</span>
        <span className="hidden text-[15px] text-muted md:block">
          {last ? t('last', { day: last }) : t('never')}
        </span>
        <ChevronRight
          size={18}
          aria-hidden="true"
          className="hidden text-subtle md:block rtl:-scale-x-100"
        />
      </Link>
    </li>
  );
}

function Skeletons() {
  const t = useTranslations('app.clients');
  return (
    <div className="flex flex-col gap-2" role="status" aria-busy="true" aria-label={t('loading')}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-[72px] rounded-card-sm" />
      ))}
    </div>
  );
}

/** Board 4.6: searchable client list with attendance counts. Table from `md`, cards on phones. */
export function ClientsView() {
  const t = useTranslations('app.clients');
  const { timezone } = useAppSession();
  const [state, dispatch] = useReducer(listReducer, initialList);
  const [text, setText] = useState('');
  const textRef = useRef(text);
  const sortRef = useRef<ClientSort>(state.sort);
  useEffect(() => {
    textRef.current = text;
    sortRef.current = state.sort;
  });

  // The debouncer lives in an effect so it can read the latest sort without touching refs during render.
  const debouncedRef = useRef<ReturnType<typeof createDebounced<[string]>> | null>(null);
  useEffect(() => {
    const d = createDebounced((value: string) => {
      dispatch({ type: 'filter', search: value, sort: sortRef.current });
    }, SEARCH_DEBOUNCE_MS);
    debouncedRef.current = d;
    return () => d.cancel();
  }, []);

  // First page of the current search/sort. Every restart bumps `seq`, so an answer to an older one is ignored.
  const { seq, search, sort } = state;
  const moreAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    // A new search or sort also cancels a "Load more" still on its way.
    moreAbort.current?.abort();
    const controller = new AbortController();
    getClients({ search, sort }, controller.signal)
      .then((page) => dispatch({ type: 'loaded', seq, page }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        dispatch({ type: 'failed', seq, error });
      });
    return () => controller.abort();
  }, [seq, search, sort]);

  const loadMore = () => {
    if (!state.nextCursor || state.loadingMore || state.status !== 'ready') return;
    dispatch({ type: 'loadMore' });
    const controller = new AbortController();
    moreAbort.current = controller;
    getClients({ search: state.search, sort: state.sort, cursor: state.nextCursor }, controller.signal)
      .then((page) => dispatch({ type: 'moreLoaded', seq: state.seq, page }))
      .catch(() => {
        if (!controller.signal.aborted) dispatch({ type: 'moreFailed', seq: state.seq });
      });
  };

  const onText = (value: string) => {
    setText(value);
    debouncedRef.current?.call(value);
  };
  const clear = () => {
    setText('');
    debouncedRef.current?.cancel();
    dispatch({ type: 'filter', search: '', sort: state.sort });
  };

  const searching = state.search.length > 0;
  const showSkeleton = state.status === 'loading' && state.items.length === 0;

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:gap-4">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            debouncedRef.current?.flush();
          }}
          className="relative flex-1"
        >
          <label htmlFor="client-search" className="sr-only">
            {t('searchLabel')}
          </label>
          <Search
            size={20}
            aria-hidden="true"
            className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            id="client-search"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            maxLength={80}
            value={text}
            onChange={(e) => onText(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-[52px] w-full rounded-pill border border-line bg-surface ps-12 pe-12 text-base text-ink placeholder:text-subtle [&::-webkit-search-cancel-button]:appearance-none"
          />
          {text ? (
            <button
              type="button"
              onClick={clear}
              aria-label={t('clearSearch')}
              className="absolute end-1 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-pill text-muted transition-colors duration-200 ease-out hover:bg-canvas"
            >
              <X size={18} aria-hidden="true" />
            </button>
          ) : null}
        </form>
        <div className="md:w-[340px]">
          <Segmented<ClientSort>
            label={t('sortLabel')}
            value={state.sort}
            options={[
              { value: 'name', label: t('sort.name') },
              { value: 'noShows', label: t('sort.noShows') },
              { value: 'recent', label: t('sort.recent') },
            ]}
            onChange={(next) => {
              debouncedRef.current?.cancel();
              dispatch({ type: 'filter', search: textRef.current, sort: next });
            }}
          />
        </div>
      </div>

      {state.status === 'error' && state.items.length === 0 ? (
        <LoadError error={state.error} onRetry={() => dispatch({ type: 'retry' })} />
      ) : showSkeleton ? (
        <Skeletons />
      ) : state.items.length === 0 ? (
        searching ? (
          <EmptyState
            icon={<SearchX size={22} />}
            title={t('noResultsTitle', { query: state.search })}
            body={t('noResultsBody')}
            action={
              <Button variant="secondary" onClick={clear}>
                {t('clearSearch')}
              </Button>
            }
          />
        ) : (
          <EmptyState icon={<UserRound size={22} />} title={t('emptyTitle')} body={t('emptyBody')} />
        )
      ) : (
        <>
          <p role="status" aria-live="polite" className="sr-only">
            {state.status === 'ready' ? t('shown', { count: state.items.length }) : ''}
          </p>
          <Card
            as="section"
            padding="none"
            aria-label={t('listLabel')}
            aria-busy={state.status === 'loading' || undefined}
            className={cn(
              'overflow-hidden transition-opacity duration-200 ease-out',
              state.status === 'loading' && 'opacity-60',
            )}
          >
            <div
              aria-hidden="true"
              className={cn(
                'hidden border-b border-row px-[22px] py-3.5 text-[13px] font-semibold tracking-[0.04em] text-muted uppercase',
                GRID,
              )}
            >
              <span>{t('col.client')}</span>
              <span>{t('col.phone')}</span>
              <span>{t('col.visits')}</span>
              <span>{t('col.noShows')}</span>
              <span>{t('col.lateCancels')}</span>
              <span>{t('col.lastVisit')}</span>
              <span />
            </div>
            <ul className="m-0 list-none p-0">
              {state.items.map((client) => (
                <ClientItem key={client.id} client={client} timezone={timezone} />
              ))}
            </ul>
          </Card>
          {state.nextCursor ? (
            <div className="flex flex-col items-center gap-2">
              {state.moreFailed ? (
                <p role="alert" className="m-0 text-sm text-danger">
                  {t('moreFailed')}
                </p>
              ) : null}
              <Button variant="secondary" size="lg" loading={state.loadingMore} onClick={loadMore}>
                {state.loadingMore ? t('loadingMore') : t('loadMore')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
