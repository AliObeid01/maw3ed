'use client';

import {
  Activity,
  ArrowRight,
  Brush,
  ChevronRight,
  CloudOff,
  Leaf,
  Scissors,
  Smile,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Bidi, ltr } from '@/components/ui/Bidi';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { getHomeCategories, getHomeDirectory, type HomeCategory as Entry } from '@/lib/api/home';
import { useResource } from '@/lib/api/useResource';
import { cn } from '@/lib/cn';
import {
  HOME_CATEGORIES,
  nextFreeTile,
  panelState,
  priceLine,
  resolveSelected,
  type HomeCategory,
} from '@/lib/home/categories';
import { dayLabel } from '@/lib/home/freeTimes';
import { categoryServiceUrl } from '@/lib/home/search';
import { PlaceCard } from './PlaceCard';

const ICONS: Record<HomeCategory, LucideIcon> = {
  barbers: Brush,
  'hair-salons': Scissors,
  'dental-clinics': Smile,
  'beauty-clinics': Sparkles,
  'spa-massage': Leaf,
  physiotherapy: Activity,
};

/** The three or fewer top places of one category (one request per category, kept in memory for 60 s). */
function TopPlaces({ category }: { category: HomeCategory }) {
  const t = useTranslations('home.categories');
  const { data, error, loading, reload } = useResource(
    () => getHomeDirectory({ category }),
    `top:${category}`,
  );
  if (loading) {
    return (
      <div aria-hidden="true" className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(min(250px,100%),1fr))]">
        <Skeleton className="h-[210px] rounded-[18px] bg-surface" />
        <Skeleton className="h-[210px] rounded-[18px] bg-surface max-sm:hidden" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[18px] bg-surface p-4 text-[15px]">
        <CloudOff size={20} aria-hidden="true" className="text-muted" />
        <span>{t('placesError')}</span>
        <Button variant="ghost" onClick={reload}>
          {t('error.retry')}
        </Button>
      </div>
    );
  }
  return (
    <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-[repeat(auto-fit,minmax(min(250px,100%),1fr))]">
      {data.businesses.map((b) => (
        <li key={b.slug} className="grid">
          <PlaceCard business={b} headingLevel={4} />
        </li>
      ))}
    </ul>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-[104px] rounded-tile bg-surface px-4 py-2.5">
      <small className="block text-[13px] text-muted">{label}</small>
      <b className="text-xl leading-tight font-bold">{children}</b>
    </div>
  );
}

function Panel({
  category,
  entry,
  unavailable,
  loading,
}: {
  category: HomeCategory;
  entry: Entry | undefined;
  unavailable: boolean;
  loading: boolean;
}) {
  const t = useTranslations('home.categories');
  const nf = useTranslations('home.nextFree');
  const locale = useLocale();
  const name = t(`names.${category}`);
  const state = entry ? panelState(entry) : null;
  const price = entry ? priceLine(entry.fromPrice) : null;
  const next = entry?.nextFree ?? null;
  const time = nextFreeTile(next);
  const day = next ? dayLabel(next.startAt, next.business.timezone, new Date(), locale) : null;
  const dayText = day
    ? day.kind === 'today'
      ? nf('today')
      : day.kind === 'tomorrow'
        ? nf('tomorrow')
        : day.text
    : null;
  const nextValue = time ? `${dayText} ${time}` : null;

  return (
    <section
      aria-labelledby="category-panel-title"
      aria-busy={loading}
      data-testid="category-panel"
      className="grid animate-fade-in content-start gap-[22px] rounded-[20px] bg-divider p-4 motion-reduce:animate-none sm:p-[22px]"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h3 id="category-panel-title" className="m-0 text-[30px] leading-[1.1] font-bold tracking-[-0.02em]">
            {name}
          </h3>
          <p className="m-0 mt-1 text-[16.5px] text-muted">{t(`desc.${category}`)}</p>
        </div>
        {entry ? (
          <div className="flex flex-wrap gap-2.5">
            <Tile label={t('tiles.places')}>
              <span dir="ltr" className="tabular-nums">{entry.places}</span>
            </Tile>
            {price ? (
              <Tile label={t('tiles.from')}>
                <bdi dir="ltr" className="tabular-nums">{price}</bdi>
              </Tile>
            ) : null}
            {nextValue ? (
              <Tile label={t('tiles.next')}>
                <bdi dir="ltr" className="tabular-nums">{nextValue}</bdi>
              </Tile>
            ) : null}
          </div>
        ) : loading ? (
          <Skeleton aria-hidden="true" className="h-[62px] w-[240px] rounded-tile bg-surface" />
        ) : null}
      </div>

      {state === 'empty' ? (
        <div data-testid="category-empty" className="grid justify-items-start gap-3 rounded-[18px] bg-surface p-5">
          <h4 className="m-0 text-lg font-semibold">{t('empty.title')}</h4>
          <p className="m-0 max-w-[52ch] text-[15px] text-muted">{t('empty.body')}</p>
          <Link href="/signup" className={buttonClasses({ variant: 'navy', size: 'hero' })}>
            {t('empty.cta')}
            <ArrowRight size={20} aria-hidden="true" className="rtl:-scale-x-100" />
          </Link>
        </div>
      ) : (
        <>
          {entry && entry.popularServices.length > 0 ? (
            <div>
              <h4 className="m-0 mb-2.5 text-sm font-semibold text-muted">{t('popular')}</h4>
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {entry.popularServices.map((s) => (
                  <li key={s.name}>
                    <Link
                      href={categoryServiceUrl(category, s.name)}
                      className="inline-flex min-h-11 items-center gap-2 rounded-pill bg-surface px-4 text-[15.5px] font-medium text-ink no-underline transition-colors duration-200 ease-out hover:bg-brand-soft motion-reduce:transition-none"
                    >
                      <Bidi>{s.name}</Bidi>
                      <em className="font-bold text-brand not-italic">
                        {t('popularPrice', { price: ltr(priceLine(s.fromPrice) ?? '') })}
                      </em>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {(entry && entry.places > 0) || unavailable ? (
            <div>
              <h4 className="m-0 mb-2.5 text-sm font-semibold text-muted">{t('top')}</h4>
              <TopPlaces category={category} />
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
            <Link href={`/directory?category=${category}`} className={buttonClasses({ variant: 'navy', size: 'hero' })}>
              {t('seeAll', { category: t(`lower.${category}`) })}
              <ArrowRight size={20} aria-hidden="true" className="rtl:-scale-x-100" />
            </Link>
            <p className="m-0 text-sm text-muted">{t('freeNote')}</p>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * "Browse by category": the six category tabs (a left list on lg, a scrolling row on phones) and the panel of the
 * chosen one. One `GET /api/public/categories` on load and one directory request per category you open. The names and
 * descriptions are static, so the section is complete even when the API fails.
 */
export function CategoryExplorer() {
  const t = useTranslations('home.categories');
  const [selected, setSelected] = useState<HomeCategory>(HOME_CATEGORIES[0]);
  const cats = useResource(getHomeCategories, 'categories');
  const list = cats.data?.categories ?? [];
  const current = resolveSelected(list, selected);
  const entryOf = (key: string) => list.find((c) => c.category === key);

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
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[330px_minmax(0,1fr)] lg:gap-[22px]">
        <nav aria-label={t('listLabel')}>
          <ul
            data-allow-overflow
            className="m-0 flex snap-x snap-mandatory list-none gap-2 overflow-x-auto p-0 pb-1.5 lg:flex-col lg:overflow-visible lg:pb-0"
          >
            {HOME_CATEGORIES.map((key) => {
              const Icon = ICONS[key];
              const entry = entryOf(key);
              const active = key === current;
              const price = entry ? priceLine(entry.fromPrice) : null;
              const stat = entry
                ? price
                  ? t('stat', { places: t('places', { count: entry.places }), price: ltr(price) })
                  : t('statNoPrice', { places: t('places', { count: entry.places }) })
                : null;
              return (
                <li key={key} className="snap-start max-lg:flex-none">
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelected(key)}
                    className={cn(
                      'grid min-h-[66px] w-full cursor-pointer grid-cols-[48px_1fr_20px] items-center gap-3 rounded-[16px] border-0 px-3.5 py-2 text-start transition-colors duration-200 ease-out max-lg:w-[236px] motion-reduce:transition-none',
                      active ? 'bg-navy text-white' : 'bg-transparent text-ink hover:bg-divider',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'grid size-12 place-items-center rounded-tile',
                        active ? 'bg-mint text-ink' : 'bg-mint/20 text-ink',
                      )}
                    >
                      <Icon size={24} />
                    </span>
                    <span className="min-w-0">
                      <b className="block text-[17px] leading-tight font-semibold">{t(`names.${key}`)}</b>
                      <small className={cn('mt-0.5 block min-h-[21px] text-sm', active ? 'text-hero-muted' : 'text-muted')}>
                        {stat ?? (cats.loading ? <Skeleton className="mt-1 h-3.5 w-24 bg-divider" /> : null)}
                      </small>
                    </span>
                    <ChevronRight
                      size={20}
                      aria-hidden="true"
                      className={cn('rtl:-scale-x-100', active ? 'text-hero-accent' : 'opacity-0')}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <Panel
          key={current}
          category={current}
          entry={entryOf(current)}
          unavailable={Boolean(cats.error)}
          loading={cats.loading}
        />
      </div>
    </div>
  );
}
