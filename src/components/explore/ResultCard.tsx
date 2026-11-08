'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Bidi, isolate, ltr } from '@/components/ui/Bidi';
import { ButtonLink } from '@/components/ui/Button';
import { BusinessAvatar } from '@/components/ui/BusinessAvatar';
import { useAreaLabel, profileLine } from '@/components/public/areaLabel';
import { useCategoryLabel } from '@/components/public/categoryLabel';
import type { DirectoryBusiness } from '@/lib/api/directory';
import { cardModel } from '@/lib/directory/card';

/**
 * One result of the Explore page (the design's business card): initials, name, "Category · Area", address, "from X USD",
 * up to four service chips with prices, the next free times (HH:mm in the business zone) and "View & book". The times
 * link to the booking page, which answers with what is free right now: a time shown here can already be taken, so the
 * copy says "Free", never a promise, and a business without times says "No free times soon" (never "fully booked").
 */
export function ResultCard({ business, now }: { business: DirectoryBusiness; now: Date }) {
  const t = useTranslations('directory.explore');
  const locale = useLocale();
  const categoryLabel = useCategoryLabel();
  const areaLabel = useAreaLabel();
  const m = cardModel(business, now, locale);
  const href = `/b/${encodeURIComponent(business.slug)}`;
  const meta = profileLine(categoryLabel(business.category), areaLabel(business.area));
  const dayText = !m.day
    ? null
    : m.day.kind === 'today'
      ? t('freeToday')
      : m.day.kind === 'tomorrow'
        ? t('freeTomorrow')
        : t('freeOn', { day: m.day.text ?? '' });

  return (
    <li className="m-0 flex list-none flex-col gap-3.5 rounded-[20px] border-[1.5px] border-divider bg-surface p-[18px] transition-colors duration-200 ease-out hover:border-electric motion-reduce:transition-none">
      <div className="flex items-center gap-3.5">
        <BusinessAvatar name={business.name} logoUrl={business.logoUrl} size={52} tone="brand" />
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[19px] leading-tight font-semibold">
            <Link href={href} className="text-ink no-underline hover:text-brand hover:underline">
              <Bidi>{business.name}</Bidi>
            </Link>
          </h2>
          {meta ? <p className="m-0 mt-0.5 text-sm text-muted">{meta}</p> : null}
          {m.address ? (
            <p className="m-0 text-sm text-muted">
              <Bidi>{m.address}</Bidi>
            </p>
          ) : null}
        </div>
      </div>

      {m.fromPrice ? (
        <p className="m-0 text-[15px] font-semibold">{t('from', { price: ltr(m.fromPrice) })}</p>
      ) : null}

      {m.services.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0" data-testid="card-services">
          {m.services.map((s, i) => (
            <li
              key={`${s.name}|${s.price}|${i}`}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-pill bg-canvas px-3 text-sm text-ink"
            >
              <Bidi>{s.name}</Bidi>
              <b className="font-semibold" dir="ltr">
                {s.price}
              </b>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-2 border-t border-divider pt-3.5">
        {m.times.length > 0 && dayText ? (
          <>
            <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-muted">
              <span>{dayText}</span>
              {m.freeService ? (
                <span className="font-normal">
                  {t('forService', { service: isolate(m.freeService) })}
                </span>
              ) : null}
            </p>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {m.times.map((time) => (
                <li key={time.iso}>
                  <Link
                    href={href}
                    aria-label={t('timeAria', { time: time.text, name: business.name })}
                    className="inline-flex min-h-11 items-center rounded-tile border-[1.5px] border-brand-avatar bg-surface px-3 text-base font-semibold text-brand sm:px-4 no-underline transition-colors duration-200 ease-out hover:border-electric hover:bg-electric hover:text-white motion-reduce:transition-none"
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
          <p className="m-0 min-h-11 content-center text-sm text-muted">{t('noFreeSoon')}</p>
        )}
      </div>

      <ButtonLink
        href={href}
        size="hero"
        block
        className="mt-auto"
        aria-label={t('viewBookAria', { name: business.name })}
      >
        {t('viewBook')}
      </ButtonLink>
    </li>
  );
}
