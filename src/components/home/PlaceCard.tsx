'use client';

import { ArrowRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { CategoryIcon } from '@/components/brand/CategoryIcon';
import { PendingLink as Link } from '@/components/public/PendingLink';
import { Bidi, isolate } from '@/components/ui/Bidi';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { BusinessAvatar } from '@/components/ui/BusinessAvatar';
import type { DirectoryBusiness } from '@/lib/api/directory';
import { cn } from '@/lib/cn';
import { priceLine } from '@/lib/home/categories';
import { dayLabel, formatFreeTime } from '@/lib/home/freeTimes';
import { profileLine, useAreaLabel } from '@/components/public/areaLabel';

/** Services listed on a card: up to this many, cheapest first (the order the API returns). */
export const CARD_SERVICES = 3;
/** Free-time chips on a card. */
export const CARD_TIMES = 3;

/** Banner colour per category (flat brand colours; the glyph watermark is the category icon in the same ink). */
const BANNERS: Record<string, string> = {
  barbers: 'bg-navy text-white',
  'hair-salons': 'bg-brand text-white',
  'dental-clinics': 'bg-cyan text-ink',
  'beauty-clinics': 'bg-turquoise text-ink',
  'spa-massage': 'bg-brand-avatar text-ink',
  physiotherapy: 'bg-electric text-white',
};

/**
 * One business as a compact card (the home category row): a coloured banner with the category glyph, the logo
 * overlapping it, name and area, up to three services with prices, the free times of the shortest service and a
 * "See all services and book" button. The times are formatted in the BUSINESS time zone the API returns and link to
 * the business page: the booking page shows what is free now. There is no "open until" line: the public directory
 * does not return working hours.
 */
export function PlaceCard({
  business,
  category,
  headingLevel = 3,
}: {
  business: DirectoryBusiness;
  category: string;
  headingLevel?: 3 | 4;
}) {
  const t = useTranslations('home');
  const locale = useLocale();
  const areaLabel = useAreaLabel();
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  const href = `/b/${encodeURIComponent(business.slug)}`;
  const zone = business.timezone ?? 'Asia/Beirut';
  const times = (business.freeTimes ?? []).slice(0, CARD_TIMES);
  const first = business.nextFree ?? null;
  const day = times[0] ? dayLabel(times[0], zone, new Date(), locale) : null;
  const dayText = day ? (day.kind === 'today' ? t('nextFree.today') : day.kind === 'tomorrow' ? t('nextFree.tomorrow') : day.text) : null;
  const meta = profileLine(areaLabel(business.area), business.address);
  const services = (business.services ?? []).slice(0, CARD_SERVICES);

  return (
    <article className="motion-lift grid h-full grid-cols-[minmax(0,1fr)] content-start overflow-hidden rounded-[18px] border border-divider bg-surface text-ink">
      <div className={cn('relative h-14 overflow-hidden', BANNERS[category] ?? 'bg-navy text-white')} aria-hidden="true">
        <CategoryIcon category={category} size={104} className="absolute -end-3 -bottom-6 opacity-25" />
      </div>
      <div className="flex items-start gap-3 px-4">
        <BusinessAvatar name={business.name} logoUrl={business.logoUrl} size={64} className="relative -mt-7 border-[3px] border-surface shadow-sm" />
        <div className="min-w-0 flex-1 pt-2">
          <Heading className="m-0 line-clamp-2 text-[17px] leading-tight font-semibold break-words">
            <Link href={href} className="text-ink no-underline hover:text-brand hover:underline">
              <Bidi>{business.name}</Bidi>
            </Link>
          </Heading>
          {meta ? <p className="m-0 mt-0.5 truncate text-sm text-muted">{meta}</p> : null}
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-2.5 px-4 pt-3 pb-4">

        {services.length > 0 ? (
          <ul data-testid="card-services" className="m-0 grid list-none gap-1 p-0">
            {services.map((s) => (
              <li key={s.name} className="flex items-baseline justify-between gap-3 text-[14.5px]">
                <span className="min-w-0 truncate">
                  <Bidi>{s.name}</Bidi>
                </span>
                <bdi dir="ltr" className="shrink-0 font-bold text-brand tabular-nums">
                  {priceLine(s.price)}
                </bdi>
              </li>
            ))}
          </ul>
        ) : null}

        {times.length > 0 && dayText && first ? (
          <div>
            {/* Two whole pieces that wrap as units (no separator dot to strand at the start of a line); the service is an isolate so Latin names keep their order in Arabic. */}
            <p data-testid="free-label" className="m-0 mb-1.5 flex flex-wrap gap-x-2 text-[13.5px] font-semibold text-muted">
              <span data-testid="free-label-service">{t('categories.freeTimesFor', { service: isolate(first.service.name) })}</span>
              <span data-testid="free-label-day" className="font-normal">{dayText}</span>
            </p>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {times.map((iso) => {
                const time = formatFreeTime(iso, zone);
                return (
                  <li key={iso}>
                    <Link
                      href={href}
                      aria-label={t('nextFree.timeAria', { time, name: business.name })}
                      className="motion-press inline-flex min-h-11 items-center rounded-tile border-[1.5px] border-brand-avatar bg-surface px-4 text-base font-semibold text-brand no-underline transition-colors duration-200 ease-out hover:border-electric hover:bg-electric hover:text-white motion-reduce:transition-none"
                    >
                      <span dir="ltr" className="tabular-nums">
                        {time}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <p className="m-0 text-sm text-muted">{t('categories.noFree')}</p>
        )}

        <Link
          href={href}
          aria-label={t('nextFree.viewPageAria', { name: business.name })}
          className={buttonClasses({ variant: 'navy', size: 'md', block: true, className: 'h-auto min-h-11 px-3 py-2 text-center whitespace-normal' })}
        >
          {t('categories.seeServices')}
          <ArrowRight size={18} aria-hidden="true" className="shrink-0 max-sm:hidden rtl:-scale-x-100" />
        </Link>
      </div>
    </article>
  );
}
