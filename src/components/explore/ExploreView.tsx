'use client';

import { CloudOff, Search, SearchX, SlidersHorizontal } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CountBadge } from '@/components/ui/CountBadge';
import { Input } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { cleanSearchParam } from '@/lib/directory/params';
import {
  NO_FILTERS,
  activeFilterCount,
  filtersToSearch,
  hasAnyFilter,
  parseFilters,
  requestUrl,
  sameFilters,
  whenDayText,
  type ExploreFilters,
} from '@/lib/directory/explore';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { OWNER_START_HREF } from '@/lib/links';
import { FilterControls, type FilterPatch } from './FilterControls';
import { ResultCard } from './ResultCard';
import { useExploreResults } from './useExploreResults';
import { useExploreToday } from './useExploreToday';

const noopSubscribe = () => () => undefined;

/**
 * The Explore page's interactive part. Rendered only in the browser: the filters depend on the viewer's calendar
 * ("today") and the results come from the public API, so the server sends the heading and a skeleton of the same size.
 */
export function ExploreView() {
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  return mounted ? <Explore /> : <ExploreSkeleton />;
}

/** Reserved space for the filters and the first row of cards (no layout shift when the client takes over). */
export function ExploreSkeleton() {
  return (
    <div aria-hidden="true" className="grid gap-6" data-testid="explore-skeleton">
      <Skeleton className="h-[148px] rounded-[20px] md:h-[226px] lg:h-[210px]" />
      <ResultsSkeleton />
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div
      className="grid grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))] gap-3.5"
      data-testid="directory-skeleton"
    >
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-[330px] rounded-[20px]" />
      ))}
    </div>
  );
}

/** After a 429 the Retry button waits this long (the limit is per address and window: an instant retry fails again). */
export const RATE_COOLDOWN_SECONDS = 10;

/** Retry, disabled with a countdown label while `cooldownSeconds` runs (mount it afresh for each failure). */
function RetryButton({ cooldownSeconds, onClick }: { cooldownSeconds: number; onClick: () => void }) {
  const t = useTranslations('directory.explore');
  const [left, setLeft] = useState(cooldownSeconds);
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  return (
    <Button variant="secondary" onClick={onClick} disabled={left > 0}>
      {left > 0 ? t('retryIn', { seconds: left }) : t('retry')}
    </Button>
  );
}

/** For business owners who land here: sign up to be listed. */
function OwnerLink({ variant }: { variant: 'empty' | 'list' }) {
  const t = useTranslations('directory.ownerCta');
  if (variant === 'empty')
    return (
      <div className="mt-2 flex flex-col items-center gap-2" data-testid="directory-owner-cta">
        <ButtonLink href={OWNER_START_HREF} variant="secondary">
          {t('link')}
        </ButtonLink>
        <p className="m-0 max-w-sm text-[13px] text-muted">{t('hint')}</p>
      </div>
    );
  return (
    <p
      className="m-0 flex flex-wrap items-center justify-center gap-x-1 text-center text-sm text-muted"
      data-testid="directory-owner-cta"
    >
      {t('own')}
      <ButtonLink href={OWNER_START_HREF} variant="ghost" size="row" className="font-semibold text-brand">
        {t('listYours')}
      </ButtonLink>
    </p>
  );
}

function Explore() {
  const t = useTranslations('directory.explore');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const wide = useMediaQuery('(min-width: 768px)');
  // Today in the Explore calendar (Asia/Beirut, refreshed across midnight): `when` runs from today to today + 28 days.
  const { today, now } = useExploreToday();
  const filters = useMemo(() => parseFilters((name) => params.get(name), today), [params, today]);
  const { state, submit, retry, loadMore } = useExploreResults(filters);

  // The text box is a draft until it is submitted; it follows the URL when the URL changes (back, Clear).
  const [text, setText] = useState(filters.search);
  const [seenSearch, setSeenSearch] = useState(filters.search);
  if (seenSearch !== filters.search) {
    setSeenSearch(filters.search);
    setText(filters.search);
  }

  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<ExploreFilters>(filters);

  /** The URL is the source of truth: writing it re-renders with the new filters, which starts the request. */
  const commit = useCallback(
    (next: ExploreFilters) => {
      if (sameFilters(next, filters)) return;
      const qs = filtersToSearch(next);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [filters, pathname, router],
  );

  const onSearch = () => {
    submit();
    commit({ ...filters, search: cleanSearchParam(text) });
  };
  const clearAll = () => {
    submit();
    setText('');
    setDraft(NO_FILTERS);
    setSheetOpen(false);
    commit(NO_FILTERS);
  };
  const apply = () => {
    submit();
    commit({ ...draft, search: filters.search });
    setSheetOpen(false);
  };

  const count = activeFilterCount(filters);
  const anyFilter = hasAnyFilter(filters);

  const searchForm = (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch();
      }}
      className="flex items-end gap-2"
    >
      <Input
        type="search"
        label={t('searchLabel')}
        placeholder={t('searchPlaceholder')}
        autoComplete="off"
        enterKeyHint="search"
        maxLength={80}
        value={text}
        onChange={(e) => setText(e.target.value)}
        wrapperClassName="min-w-0 flex-1"
      />
      <Button type="submit" size="lg" className="h-[52px] shrink-0 max-sm:w-[52px] max-sm:px-0">
        <Search size={18} aria-hidden="true" />
        <span className="max-sm:sr-only">{t('searchSubmit')}</span>
      </Button>
    </form>
  );

  const showSkeleton = state.initial && !state.failed;
  const failedWithItems = state.failed && state.items.length > 0;
  const empty =
    !state.initial && !state.pending && !state.failed && state.items.length === 0;
  const stale = state.pending && !state.initial;

  return (
    <div className="grid gap-6">
      {wide ? (
        <section
          aria-label={t('filtersTitle')}
          className="rounded-[20px] border-[1.5px] border-divider p-4"
        >
          <FilterControls
            variant="bar"
            idPrefix="bar"
            value={filters}
            today={today}
            leading={searchForm}
            onChange={(patch: FilterPatch) => {
              commit({ ...filters, ...patch });
            }}
          />
          {anyFilter ? (
            <div className="mt-3 flex">
              <Button variant="ghost" className="-ms-4" onClick={clearAll}>
                {t('clear')}
              </Button>
            </div>
          ) : null}
        </section>
      ) : (
        <div className="grid gap-3">
          {searchForm}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setDraft(filters);
                setSheetOpen(true);
              }}
              aria-haspopup="dialog"
            >
              <SlidersHorizontal size={18} aria-hidden="true" />
              {t('filtersButton')}
              <CountBadge
                count={count}
                tone="warning"
                label={t('filtersApplied', { count })}
                className="bg-brand text-white"
              />
            </Button>
            {anyFilter ? (
              <Button variant="ghost" onClick={clearAll}>
                {t('clear')}
              </Button>
            ) : null}
          </div>
        </div>
      )}

      <Sheet
        open={sheetOpen && !wide}
        onOpenChange={setSheetOpen}
        title={t('filtersTitle')}
        closeLabel={t('close')}
      >
        <FilterControls
          variant="sheet"
          idPrefix="sheet"
          value={draft}
          today={today}
          onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        />
        <div className="sticky bottom-0 mt-5 flex gap-2 bg-surface pt-2 pb-1">
          <Button variant="secondary" className="flex-1" onClick={clearAll}>
            {t('clear')}
          </Button>
          <Button className="flex-1" onClick={apply}>
            {t('apply')}
          </Button>
        </div>
      </Sheet>

      <p role="status" className="sr-only" data-testid="explore-live">
        {!state.initial && !state.pending && !state.failed
          ? t('found', { count: state.items.length })
          : ''}
      </p>

      {state.failed ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-[16px] bg-warning-soft p-4 text-[15px] text-ink"
          data-testid="explore-error"
        >
          <CloudOff size={20} aria-hidden="true" className="text-warning" />
          <span className="min-w-0 flex-1">
            <b className="font-semibold">
              {state.failed === 'rate' ? t('rateLimited') : t('errorTitle')}
            </b>{' '}
            {state.failed === 'rate'
              ? failedWithItems
                ? t('stillShowing')
                : null
              : failedWithItems
                ? t('stillShowing')
                : t('errorBody')}
          </span>
          <RetryButton
            key={`${requestUrl(filters)}|${state.failed}`}
            cooldownSeconds={state.failed === 'rate' ? RATE_COOLDOWN_SECONDS : 0}
            onClick={retry}
          />
        </div>
      ) : null}

      <div aria-busy={state.pending} className="grid gap-5">
        {showSkeleton ? (
          <>
            <span className="sr-only">{t('loading')}</span>
            <ResultsSkeleton />
          </>
        ) : empty ? (
          <EmptyState anyFilter={anyFilter} when={filters.when} onClear={clearAll} />
        ) : state.items.length > 0 ? (
          <>
            <div className="grid gap-1">
              <p className="m-0 font-semibold text-muted" data-testid="explore-count">
                {t('showing', { count: state.items.length })}
              </p>
              {filters.when ? (
                <p className="m-0 text-sm text-muted">
                  {t('whenNote', { day: whenDayText(filters.when, locale) })}
                </p>
              ) : null}
            </div>
            <ul
              aria-label={t('showing', { count: state.items.length })}
              className={
                'm-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))] gap-3.5 p-0 transition-opacity duration-200 ease-out motion-reduce:transition-none' +
                (stale ? ' opacity-60' : '')
              }
            >
              {state.items.map((b) => (
                <ResultCard key={b.slug} business={b} now={now} />
              ))}
            </ul>
            <div className="flex flex-col items-center gap-2">
              {state.more === 'rate' || state.more === 'error' ? (
                <p role="alert" className="m-0 text-sm text-danger">
                  {state.more === 'rate' ? t('rateLimited') : t('moreError')}
                </p>
              ) : null}
              {state.cursor ? (
                <Button
                  variant="secondary"
                  loading={state.more === 'loading'}
                  disabled={state.more === 'loading' || state.pending || Boolean(state.failed)}
                  onClick={loadMore}
                >
                  {t('showMore')}
                </Button>
              ) : !state.pending ? (
                <p className="m-0 text-sm text-muted" data-testid="explore-end">
                  {t('noMore')}
                </p>
              ) : null}
            </div>
            <OwnerLink variant="list" />
          </>
        ) : null}
      </div>

      <p className="m-0 text-center text-[13px] text-muted">{t('timeNote')}</p>
    </div>
  );
}

function EmptyState({
  anyFilter,
  when,
  onClear,
}: {
  anyFilter: boolean;
  when: string;
  onClear: () => void;
}) {
  return (
    <Card className="flex flex-col items-center gap-3 py-10 text-center" data-testid="explore-empty">
      <span
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-[18px] bg-brand-soft text-brand"
      >
        <SearchX size={26} />
      </span>
      {anyFilter ? <NoMatch when={when} onClear={onClear} /> : <NoneListed />}
    </Card>
  );
}

/** Filters (or a search) matched nothing. */
function NoMatch({ when, onClear }: { when: string; onClear: () => void }) {
  const t = useTranslations('directory.explore');
  return (
    <>
      <h2 className="m-0 text-xl font-semibold">{t('emptyTitle')}</h2>
      <p className="m-0 max-w-sm text-[15px] text-muted">
        {when ? t('emptyBodyWhen') : t('emptyBody')}
      </p>
      <Button variant="secondary" onClick={onClear}>
        {t('clear')}
      </Button>
    </>
  );
}

/** No filters and still nothing: no business has chosen to be listed yet. */
function NoneListed() {
  const t = useTranslations('directory.empty');
  return (
    <>
      <h2 className="m-0 text-xl font-semibold">{t('title')}</h2>
      <p className="m-0 max-w-sm text-[15px] text-muted">{t('body')}</p>
      <OwnerLink variant="empty" />
    </>
  );
}
