'use client';

import { ArrowRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { PendingLink as Link } from '@/components/public/PendingLink';
import { Bidi, isolate, ltr } from '@/components/ui/Bidi';
import { BusinessAvatar } from '@/components/ui/BusinessAvatar';
import type { DirectoryBusiness } from '@/lib/api/directory';
import { priceLine } from '@/lib/home/categories';
import { dayLabel, formatFreeTime } from '@/lib/home/freeTimes';
import { profileLine, useAreaLabel } from '@/components/public/areaLabel';

/** Service chips on a card: up to this many, cheapest first (the order the API returns). */
export const CARD_SERVICES = 3;

/**
 * One business with its services and next free times (the category panel's "Top places"). The times are formatted in
 * the BUSINESS time zone the API returns and link to the business page: the booking page shows what is free now.
 * The free times belong to the shortest service (`nextFree.service`), and the label says which.
 */
export function PlaceCard({ business, headingLevel = 3 }: { business: DirectoryBusiness; headingLevel?: 3 | 4 }) {
  const t = useTranslations('home');
  const locale = useLocale();
  const areaLabel = useAreaLabel();
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  const href = `/b/${encodeURIComponent(business.slug)}`;
  const zone = business.timezone ?? 'Asia/Beirut';
  const times = (business.freeTimes ?? []).slice(0, 4);
  const first = business.nextFree ?? null;
  const day = times[0] ? dayLabel(times[0], zone, new Date(), locale) : null;
  const dayText = day ? (day.kind === 'today' ? t('nextFree.today') : day.kind === 'tomorrow' ? t('nextFree.tomorrow') : day.text) : null;
  const meta = profileLine(areaLabel(business.area), business.address);
  const services = (business.services ?? []).slice(0, CARD_SERVICES);

  return (
    <article className="motion-lift grid grid-cols-[minmax(0,1fr)] content-start gap-3.5 rounded-[18px] bg-surface p-4 text-ink">
      <div className="flex items-center gap-3">
        <BusinessAvatar name={business.name} logoUrl={business.logoUrl} size={46} />
        <div className="min-w-0 flex-1">
          <Heading className="m-0 line-clamp-2 text-[17px] leading-tight font-semibold break-words">
            <Link
              href={href}
              className="text-ink no-underline hover:text-brand hover:underline"
            >
              <Bidi>{business.name}</Bidi>
            </Link>
          </Heading>
          {meta ? <p className="m-0 truncate text-sm text-muted">{meta}</p> : null}
        </div>
      </div>

      {services.length > 0 ? (
        <ul data-testid="card-services" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {services.map((s) => (
            <li
              key={s.name}
              className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-pill bg-divider px-3 text-[14px] font-medium"
            >
              <span className="truncate">
                <Bidi>{s.name}</Bidi>
              </span>
              <em className="shrink-0 font-bold text-brand not-italic">
                {t('categories.popularPrice', { price: ltr(priceLine(s.price) ?? '') })}
              </em>
            </li>
          ))}
        </ul>
      ) : null}

      {times.length > 0 && dayText && first ? (
        <div>
          {/* Two whole pieces that wrap as units (no separator dot to strand at the start of a line); the service is an isolate so Latin names keep their order in Arabic. */}
          <p data-testid="free-label" className="m-0 mb-2 flex flex-wrap gap-x-2 text-sm font-semibold text-muted">
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
                    className="motion-lift motion-press inline-flex min-h-11 items-center rounded-tile border-[1.5px] border-brand-avatar bg-surface px-4 text-base font-semibold text-brand no-underline transition-colors duration-200 ease-out hover:border-electric hover:bg-electric hover:text-white motion-reduce:transition-none"
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
        className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-brand no-underline hover:underline"
      >
        {t('nextFree.viewPage')}
        <ArrowRight size={18} aria-hidden="true" className="rtl:-scale-x-100" />
      </Link>
    </article>
  );
}
