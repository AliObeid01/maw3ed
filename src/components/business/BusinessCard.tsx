'use client';

import { ArrowRight, MapPin } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { CategoryIcon } from '@/components/brand/CategoryIcon';
import { profileLine, useAreaLabel } from '@/components/public/areaLabel';
import { useCategoryLabel } from '@/components/public/categoryLabel';
import { PendingLink as Link } from '@/components/public/PendingLink';
import { Bidi, ltr } from '@/components/ui/Bidi';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { BusinessAvatar } from '@/components/ui/BusinessAvatar';
import type { DirectoryBusiness } from '@/lib/api/directory';
import { cn } from '@/lib/cn';
import { cardModel } from '@/lib/directory/card';
import { durationParts } from '@/lib/directory/duration';
import { isHomeCategory } from '@/lib/home/categories';
import { useNow } from '@/lib/home/useNow';

/**
 * Banner per category (our brand colours as a soft diagonal gradient). Unknown or legacy free-text categories get
 * the navy one. The pill sits on a navy wash so white text keeps its contrast on the light banners too.
 */
const BANNERS: Record<string, string> = {
  barbers: 'from-navy to-navy-hover',
  'hair-salons': 'from-brand to-electric',
  'dental-clinics': 'from-turquoise to-mint',
  'beauty-clinics': 'from-cyan to-[#6fd6f7]',
  'spa-massage': 'from-brand-deep to-brand',
  physiotherapy: 'from-electric to-cyan',
};

const DOTS =
  'bg-[radial-gradient(rgb(255_255_255/0.32)_1px,transparent_1.2px)] bg-[length:14px_14px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]';

type Duration = ReturnType<typeof durationParts>;

/**
 * THE business card: the same on the home category row, Explore and anywhere a business is listed. A gradient banner
 * with a dot pattern, the category pill and a glyph watermark; the logo overlapping the banner; name, area and the
 * open-now line; up to three services with length and price; the free times of the shortest service and a
 * "See all services and book" button. Times are HH:mm in the BUSINESS zone the API returns and link to the business
 * page, which shows what is free right now (so the copy says "Free", never a promise). Relative labels ("today")
 * follow the shared minute clock, so a page left open stays correct.
 */
export function BusinessCard({
  business,
  category,
  headingLevel = 3,
}: {
  business: DirectoryBusiness;
  /** The category key for the banner; defaults to the business's own. */
  category?: string | null;
  headingLevel?: 2 | 3 | 4;
}) {
  const t = useTranslations('public.businessCard');
  const locale = useLocale();
  const categoryLabel = useCategoryLabel();
  const areaLabel = useAreaLabel();
  const now = useNow();
  const m = cardModel(business, now, locale);
  const Heading = headingLevel === 2 ? 'h2' : headingLevel === 3 ? 'h3' : 'h4';
  const href = `/b/${encodeURIComponent(business.slug)}`;
  const raw = (category ?? business.category ?? '').toLowerCase();
  const key = isHomeCategory(raw) ? raw : null;
  const pill = key ? t(`pill.${key}`) : categoryLabel(business.category);
  const meta = profileLine(areaLabel(business.area), business.address);
  const dayText = !m.day
    ? null
    : m.day.kind === 'today'
      ? t('freeToday')
      : m.day.kind === 'tomorrow'
        ? t('freeTomorrow')
        : t('freeOn', { day: m.day.text ?? '' });
  const duration = (d: Duration) =>
    d.kind === 'min'
      ? t('duration.min', { count: d.count })
      : d.kind === 'h'
        ? t('duration.h', { count: d.count })
        : t('duration.hMin', { hours: d.hours, minutes: d.minutes });
  const status = m.open
    ? m.open.open && m.open.until
      ? { open: true, text: t('open', { time: ltr(m.open.until) }) }
      : { open: false, text: m.open.opensAt ? t('closedOpens', { time: ltr(m.open.opensAt) }) : t('closedToday') }
    : null;

  return (
    <article
      data-testid="business-card"
      className="motion-lift flex h-full flex-col overflow-hidden rounded-[22px] border border-divider bg-surface text-ink shadow-[0_1px_2px_rgb(11_25_56/0.04)]"
    >
      <div
        aria-hidden="true"
        className={cn('relative h-[120px] shrink-0 overflow-hidden bg-gradient-to-br text-white', key ? BANNERS[key] : 'from-navy to-navy-hover')}
      >
        <div className={cn('absolute inset-0', DOTS)} />
        <CategoryIcon category={key ?? 'other'} size={112} className="absolute end-3 top-3 opacity-[0.22]" />
        {pill ? (
          <span className="absolute start-4 top-4 inline-flex max-w-[60%] items-center truncate rounded-pill bg-navy/45 px-3 py-1 text-[13px] leading-5 font-semibold text-white">
            {pill}
          </span>
        ) : null}
      </div>

      <div className="px-5">
        <BusinessAvatar
          name={business.name}
          logoUrl={business.logoUrl}
          size={64}
          className="relative -mt-9 rounded-[18px] border-[3px] border-surface shadow-[0_6px_16px_rgb(11_25_56/0.18)]"
        />
      </div>

      <div className="flex flex-1 flex-col gap-3 px-5 pt-3 pb-5">
        <div className="grid gap-1">
          <Heading className="m-0 line-clamp-2 text-[21px] leading-tight font-bold tracking-[-0.01em] break-words">
            <Link href={href} className="text-ink no-underline hover:text-brand hover:underline">
              <Bidi>{business.name}</Bidi>
            </Link>
          </Heading>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted">
            {meta ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <MapPin size={15} aria-hidden="true" className="shrink-0" />
                <span className="truncate">
                  <Bidi>{meta}</Bidi>
                </span>
              </span>
            ) : null}
            {status ? (
              <span data-testid="open-status" className={cn('inline-flex items-center gap-1.5 font-medium', status.open ? 'text-success' : 'text-muted')}>
                <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', status.open ? 'bg-success' : 'bg-muted/60')} />
                {status.text}
              </span>
            ) : null}
          </div>
        </div>

        {m.services.length > 0 ? (
          <ul data-testid="card-services" aria-label={t('servicesLabel')} className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-1.5 border-t border-divider p-0 pt-3">
            {m.services.map((s, i) => (
              <li key={`${s.name}|${s.price}|${i}`} className="flex items-baseline justify-between gap-3 text-[15px]">
                <span className="flex min-w-0 items-baseline gap-1">
                  <span className="min-w-0 truncate">
                    <Bidi>{s.name}</Bidi>
                  </span>
                  <span className="shrink-0 text-[13px] whitespace-nowrap text-muted">· {duration(durationParts(s.durationMin))}</span>
                </span>
                <bdi dir="ltr" className="shrink-0 font-bold tabular-nums">
                  {s.price}
                </bdi>
              </li>
            ))}
            {m.moreCount > 0 ? (
              <li className="flex">
                <Link
                  href={href}
                  data-testid="card-more"
                  aria-label={t('moreAria', { count: m.moreCount, name: business.name })}
                  className="inline-flex min-h-11 items-center text-[14px] font-semibold text-brand no-underline hover:underline"
                >
                  {t('more', { count: m.moreCount })}
                </Link>
              </li>
            ) : null}
          </ul>
        ) : null}

        <div className="grid gap-2 border-t border-divider pt-3">
          {m.times.length > 0 && dayText ? (
            <>
              <p data-testid="free-label" className="m-0 text-[13px] font-semibold text-muted">
                <span data-testid="free-label-day">{dayText}</span>
              </p>
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {m.times.map((time) => (
                  <li key={time.iso}>
                    <Link
                      href={href}
                      aria-label={t('timeAria', { time: time.text, name: business.name })}
                      className="motion-press inline-flex min-h-11 min-w-[64px] items-center justify-center rounded-tile border border-brand-avatar bg-surface px-3.5 text-base font-semibold text-ink no-underline transition-colors duration-200 ease-out hover:border-electric hover:bg-electric hover:text-white motion-reduce:transition-none"
                    >
                      <span dir="ltr" className="tabular-nums">
                        {time.text}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="m-0 min-h-11 content-center text-sm text-muted">{t('noFree')}</p>
          )}
        </div>

        <Link
          href={href}
          aria-label={t('ctaAria', { name: business.name })}
          className={buttonClasses({ variant: 'navy', size: 'md', block: true, className: 'mt-auto h-12 rounded-pill px-4 text-center' })}
        >
          {t('cta')}
          <ArrowRight size={18} aria-hidden="true" className="shrink-0 rtl:-scale-x-100" />
        </Link>
      </div>
    </article>
  );
}
