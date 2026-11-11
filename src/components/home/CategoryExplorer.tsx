'use client';

import { ArrowRight, CloudOff } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';
import { CategoryIcon } from '@/components/brand/CategoryIcon';
import { BusinessCard, CARD_SKELETON_MIN_H } from '@/components/business/BusinessCard';
import { PendingLink as Link } from '@/components/public/PendingLink';
import { ltr } from '@/components/ui/Bidi';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { getCategoriesCached, getHomeDirectory, type HomeCategory as Entry } from '@/lib/api/home';
import { useResource } from '@/lib/api/useResource';
import { cn } from '@/lib/cn';
import {
  HOME_CATEGORIES,
  listedCategories,
  nextFreeTile,
  priceLine,
  resolveSelected,
  type HomeCategory,
} from '@/lib/home/categories';
import { dayLabel } from '@/lib/home/freeTimes';
import { useNow } from '@/lib/home/useNow';
import { OWNER_START_HREF } from '@/lib/links';


const CARD_ROW =
  'm-0 flex snap-x snap-mandatory list-none gap-3 overflow-x-auto p-0 pb-2 md:grid md:grid-cols-2 md:overflow-visible md:pb-0 lg:grid-cols-3';
/** Phones: a card is 86 % wide so the next one peeks; md and up the cards fill the grid. */
const CARD_ITEM = 'w-[86%] max-w-[340px] flex-none snap-start md:w-auto md:max-w-none';

/** The three or fewer top places of one category (one request per category, kept in memory for 60 s). */
function TopPlaces({ category }: { category: HomeCategory }) {
  const t = useTranslations('home.categories');
  const { data, error, loading, reload } = useResource(
    () => getHomeDirectory({ category }),
    `top:${category}`,
  );
  if (loading) {
    return (
      <div aria-hidden="true" data-testid="top-skeleton" className="flex gap-3 overflow-hidden md:grid md:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className={cn(CARD_SKELETON_MIN_H, 'rounded-[18px] bg-divider', CARD_ITEM, i === 2 && 'md:max-lg:hidden')} />
        ))}
      </div>
    );
  }
  if (error || !data) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[18px] bg-divider p-4 text-[15px]">
        <CloudOff size={20} aria-hidden="true" className="text-muted" />
        <span>{t('placesError')}</span>
        <Button variant="ghost" onClick={reload}>
          {t('error.retry')}
        </Button>
      </div>
    );
  }
  return (
    <ul data-allow-overflow data-testid="top-places" aria-label={t('cardsLabel', { category: t(`lower.${category}`) })} className={CARD_ROW}>
      {data.businesses.slice(0, 3).map((b, i) => (
        <li key={b.slug} className={cn('grid grid-cols-[minmax(0,1fr)]', CARD_ITEM, i === 2 && 'md:max-lg:hidden')}>
          <BusinessCard business={b} category={category} headingLevel={4} />
        </li>
      ))}
    </ul>
  );
}

/** "Next free" for the header line: "Today 10:30", "Tomorrow 12:15" or "Mon 09:30". */
function nextFreeText(next: Entry['nextFree'], locale: string, now: Date, nf: (key: 'today' | 'tomorrow') => string): string | null {
  const time = nextFreeTile(next);
  if (!next || !time) return null;
  const day = dayLabel(next.startAt, next.business.timezone, now, locale);
  const dayText = day.kind === 'today' ? nf('today') : day.kind === 'tomorrow' ? nf('tomorrow') : day.text;
  return `${dayText} ${time}`;
}

/** One stat of the category header: a small white tile, muted label over a bold value. */
function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-0.5 rounded-[14px] border border-divider bg-surface px-3.5 py-2.5">
      <dt className="truncate text-[12.5px] leading-tight text-muted">{label}</dt>
      <dd className="m-0 text-[16px] leading-tight font-bold tabular-nums sm:text-[18px]">{value}</dd>
    </div>
  );
}

function Panel({
  category,
  entry,
  unavailable,
  loading,
  tabId,
}: {
  category: HomeCategory;
  entry: Entry | undefined;
  unavailable: boolean;
  loading: boolean;
  tabId: string;
}) {
  const t = useTranslations('home.categories');
  const nf = useTranslations('home.nextFree');
  const locale = useLocale();
  const name = t(`names.${category}`);
  const price = entry ? priceLine(entry.fromPrice) : null;
  const now = useNow();
  const nextValue = entry ? nextFreeText(entry.nextFree, locale, now, nf) : null;

  return (
    <div
      role="tabpanel"
      id={`${tabId}-panel`}
      aria-labelledby={tabId}
      aria-busy={loading}
      data-testid="category-panel"
      className="grid animate-fade-in content-start gap-3.5 motion-reduce:animate-none"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="grid min-w-0 gap-0.5">
          <h3 className="m-0 text-[24px] leading-tight font-bold tracking-[-0.01em]">{name}</h3>
          <Link
            href={`/directory?category=${category}`}
            className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-brand no-underline hover:underline"
          >
            {t('seeAll', { category: t(`lower.${category}`) })}
            <ArrowRight size={18} aria-hidden="true" className="rtl:-scale-x-100" />
          </Link>
        </div>
        {entry ? (
          <dl data-testid="category-meta" className="m-0 grid w-full auto-cols-fr grid-flow-col gap-2 md:w-auto md:min-w-[420px]">
            <Tile label={t('tiles.places')} value={String(entry.places)} />
            {price ? <Tile label={t('tiles.from')} value={ltr(price)} /> : null}
            {nextValue ? <Tile label={t('tiles.next')} value={ltr(nextValue)} /> : null}
          </dl>
        ) : loading ? (
          <Skeleton aria-hidden="true" className="h-[62px] w-full rounded-[14px] bg-divider md:w-[420px]" />
        ) : null}
      </div>

      {(entry && entry.places > 0) || unavailable ? <TopPlaces category={category} /> : null}
      <p className="m-0 text-sm text-muted">{t('freeNote')}</p>
    </div>
  );
}

function ExplorerSkeleton() {
  const t = useTranslations('home.categories');
  return (
    <div role="status" aria-busy="true" data-testid="category-skeleton" className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <span className="sr-only">{t('loading')}</span>
      <div aria-hidden="true" className="flex gap-2.5 overflow-hidden">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-[76px] w-[132px] flex-none rounded-[16px] lg:w-auto lg:flex-1" />
        ))}
      </div>
      <Skeleton aria-hidden="true" className="h-[88px] w-full rounded-tile" />
      <div aria-hidden="true" className="flex gap-3 overflow-hidden md:grid md:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className={cn(CARD_SKELETON_MIN_H, 'rounded-[18px]', CARD_ITEM, i === 2 && 'md:max-lg:hidden')} />
        ))}
      </div>
    </div>
  );
}

/** Nothing is listed yet: an invitation instead of an empty two-pane. */
function BeFirst() {
  const t = useTranslations('home.categories');
  return (
    <div data-testid="category-first" className="grid justify-items-start gap-3 rounded-[20px] bg-divider p-6 sm:p-8">
      <h3 className="m-0 text-[26px] leading-tight font-bold">{t('first.title')}</h3>
      <p className="m-0 max-w-[52ch] text-[16px] text-muted">{t('first.body')}</p>
      <Link href={OWNER_START_HREF} className={buttonClasses({ variant: 'navy', size: 'hero' })}>
        {t('first.cta')}
        <ArrowRight size={20} aria-hidden="true" className="rtl:-scale-x-100" />
      </Link>
    </div>
  );
}

/**
 * "Browse by category": a row of category tiles (tabs; a swipe row on phones) and, below, the header line and up to
 * three business cards of the chosen one. One `GET /api/public/categories` (shared with the hero chips, kept 60 s)
 * and one directory request per category you open. Categories with no places are hidden (live data); with none at
 * all a "Be the first" block takes the place of the tabs; while loading a skeleton of the same size shows, never the
 * invitation. If the API fails the six static names are listed so the section is still usable.
 */
export function CategoryExplorer() {
  const t = useTranslations('home.categories');
  const baseId = useId();
  const [selected, setSelected] = useState<HomeCategory | null>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const cats = useResource(() => getCategoriesCached(''), 'categories');
  const list = cats.data?.categories ?? [];
  const loaded = Boolean(cats.data);
  const listed = listedCategories(list);
  const keys: readonly HomeCategory[] = loaded ? listed : HOME_CATEGORIES;
  const current = resolveSelected(list, selected);
  const entryOf = (key: string) => list.find((c) => c.category === key);
  const tabId = (key: string) => `${baseId}-tab-${key}`;

  const onKeyDown = (event: React.KeyboardEvent) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const index = keys.indexOf(current);
    let next = index;
    if (event.key === 'ArrowRight') next = index + (rtl ? -1 : 1);
    else if (event.key === 'ArrowLeft') next = index + (rtl ? 1 : -1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = keys.length - 1;
    else return;
    event.preventDefault();
    const key = keys[(next + keys.length) % keys.length];
    if (!key) return;
    setSelected(key);
    tabRefs.current.get(key)?.focus();
  };

  if (!loaded && !cats.error) {
    return (
      <div className="mt-[26px] rounded-[24px] border-[1.5px] border-divider p-3.5 sm:p-[22px] lg:p-[26px]">
        <ExplorerSkeleton />
      </div>
    );
  }
  if (loaded && listed.length === 0) {
    return (
      <div className="mt-[26px] rounded-[24px] border-[1.5px] border-divider p-3.5 sm:p-[22px] lg:p-[26px]">
        <BeFirst />
      </div>
    );
  }

  return (
    <div className="mt-[26px] rounded-[24px] border-[1.5px] border-divider p-3.5 sm:p-[22px] lg:p-[26px]">
      {cats.error ? (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-[16px] bg-divider p-4 text-[15px]">
          <CloudOff size={20} aria-hidden="true" className="text-muted" />
          <span>
            <b className="font-semibold">{t('error.title')}.</b> {t('error.body')}
          </span>
          <Button variant="secondary" onClick={cats.reload}>
            {t('error.retry')}
          </Button>
        </div>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <div
          role="tablist"
          aria-label={t('listLabel')}
          data-allow-overflow
          onKeyDown={onKeyDown}
          className="flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-1.5 lg:grid lg:auto-cols-fr lg:grid-flow-col lg:overflow-visible lg:pb-0"
        >
          {keys.map((key) => {
            const entry = entryOf(key);
            const active = key === current;
            const price = entry ? priceLine(entry.fromPrice) : null;
            return (
              <button
                key={key}
                ref={(el) => {
                  if (el) tabRefs.current.set(key, el);
                  else tabRefs.current.delete(key);
                }}
                type="button"
                role="tab"
                id={tabId(key)}
                aria-selected={active}
                aria-controls={active ? `${tabId(key)}-panel` : undefined}
                tabIndex={active ? 0 : -1}
                onClick={() => setSelected(key)}
                className={cn(
                  'motion-press grid min-h-[76px] w-[132px] flex-none cursor-pointer snap-start content-center justify-items-start gap-1 rounded-[16px] border-[1.5px] px-3.5 py-2.5 text-start transition-colors duration-200 ease-out motion-reduce:transition-none sm:w-[148px] lg:w-auto',
                  active ? 'border-navy bg-navy text-white' : 'border-divider bg-surface text-ink hover:bg-divider',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn('grid size-8 place-items-center rounded-nav', active ? 'bg-mint text-ink' : 'bg-mint/20 text-ink')}
                >
                  <CategoryIcon category={key} size={20} />
                </span>
                <b className="block max-w-full truncate text-[15px] leading-tight font-semibold">{t(`names.${key}`)}</b>
                <small className={cn('block min-h-[18px] text-[13px] leading-tight', active ? 'text-hero-muted' : 'text-muted')}>
                  {price ? t('fromShort', { price: ltr(price) }) : null}
                </small>
              </button>
            );
          })}
        </div>
        <Panel
          key={current}
          category={current}
          entry={entryOf(current)}
          unavailable={Boolean(cats.error)}
          loading={cats.loading}
          tabId={tabId(current)}
        />
      </div>
      {loaded && listed.length < HOME_CATEGORIES.length ? (
        <p data-testid="categories-soon" className="m-0 mt-3 flex flex-wrap items-center gap-x-1.5 px-1 text-[14.5px] text-muted">
          {t('moreSoon')}
          <Link href={OWNER_START_HREF} className="inline-flex min-h-11 items-center font-semibold text-brand no-underline hover:underline">
            {t('moreSoonCta')}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
