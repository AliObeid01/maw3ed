'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Bidi, ltr } from '@/components/ui/Bidi';
import { cn } from '@/lib/cn';
import type { DirectoryBusiness } from '@/lib/api/directory';
import { priceLine } from '@/lib/home/categories';
import { dayLabel, formatFreeTime } from '@/lib/home/freeTimes';
import { useAppFormat } from '@/lib/useAppFormat';
import { profileLine, useAreaLabel } from '@/components/public/areaLabel';
import { monogram } from '@/components/public/monogram';

/**
 * One business with its next free times (home hero panel and category "Top places"). The times are formatted in
 * the BUSINESS time zone the API returns and link to the business page: the booking page shows what is free now.
 */
export function PlaceCard({
  business,
  headingLevel = 3,
  avatar = 'brand',
}: {
  business: DirectoryBusiness;
  headingLevel?: 3 | 4;
  avatar?: 'brand' | 'navy';
}) {
  const t = useTranslations('home');
  const locale = useLocale();
  const { duration } = useAppFormat();
  const areaLabel = useAreaLabel();
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  const href = `/b/${encodeURIComponent(business.slug)}`;
  const zone = business.timezone ?? 'Asia/Beirut';
  const times = (business.freeTimes ?? []).slice(0, 4);
  const first = business.nextFree ?? null;
  const day = times[0] ? dayLabel(times[0], zone, new Date(), locale) : null;
  const dayText = day ? (day.kind === 'today' ? t('nextFree.today') : day.kind === 'tomorrow' ? t('nextFree.tomorrow') : day.text) : null;
  const price = priceLine(business.fromPrice);
  const meta = profileLine(areaLabel(business.area), business.address);

  return (
    <article className="grid content-start gap-3.5 rounded-[18px] bg-surface p-4 text-ink">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={cn(
            'grid size-[46px] shrink-0 place-items-center rounded-tile text-base font-bold text-white',
            avatar === 'navy' ? 'bg-navy' : 'bg-brand',
          )}
        >
          {monogram(business.name)}
        </span>
        <div className="min-w-0 flex-1">
          <Heading className="m-0 truncate text-[17px] leading-tight font-semibold">
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

      {first || price ? (
        <p className="m-0 flex flex-wrap items-center justify-between gap-x-3 text-[15px]">
          {first ? (
            <span className="text-muted">
              <Bidi>{first.service.name}</Bidi> · {duration(first.service.durationMin)}
            </span>
          ) : (
            <span />
          )}
          {price ? (
            <b className="font-semibold">{t('categories.openNow', { price: ltr(price) })}</b>
          ) : null}
        </p>
      ) : null}

      {times.length > 0 && dayText ? (
        <div>
          <p className="m-0 mb-2 text-sm font-semibold text-muted">{dayText}</p>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {times.map((iso) => {
              const time = formatFreeTime(iso, zone);
              return (
                <li key={iso}>
                  <Link
                    href={href}
                    aria-label={t('nextFree.timeAria', { time, name: business.name })}
                    className="inline-flex min-h-11 items-center rounded-tile border-[1.5px] border-brand-avatar bg-surface px-4 text-base font-semibold text-brand no-underline transition-colors duration-200 ease-out hover:border-electric hover:bg-electric hover:text-white motion-reduce:transition-none"
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
