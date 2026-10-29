'use client';

import { CircleCheck, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useBookingFormat } from '@/components/booking/useBookingFormat';
import { Card } from '@/components/ui/Card';
import { Chip, type ChipTone } from '@/components/ui/Chip';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { getWaitlistActivity, type WaitlistActivity } from '@/lib/api/dashboard';
import { useResource } from '@/lib/api/useResource';
import { errorKey } from '@/lib/setup/errors';
import { usePolling } from '@/components/app/usePolling';

/** "Do this first": the most prominent element on Today. With nothing to send it becomes a calm confirmation. */
export function DoThisFirst({ count }: { count: number }) {
  const t = useTranslations('app.today.doFirst');
  if (count <= 0) {
    return (
      <Card
        size="sm"
        padding="compact"
        className="flex items-center gap-3"
        role="status"
        aria-label={t('allSentTitle')}
      >
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-pill bg-success-soft text-success"
        >
          <CircleCheck size={20} />
        </span>
        <span className="flex flex-col">
          <span className="text-base font-semibold">{t('allSentTitle')}</span>
          <span className="text-sm text-muted">{t('allSentBody')}</span>
        </span>
      </Card>
    );
  }
  return (
    <section
      aria-labelledby="do-this-first"
      className="bg-hero flex flex-col gap-3 rounded-card p-5 text-white"
    >
      <span
        id="do-this-first"
        className="text-[13px] font-semibold tracking-[0.06em] text-hero-subtle uppercase"
      >
        {t('eyebrow')}
      </span>
      <span className="text-2xl leading-tight font-semibold">{t('title', { count })}</span>
      <Link
        href="/app/reminders"
        className="inline-flex h-11 items-center self-start rounded-pill bg-accent px-[18px] text-[15px] font-semibold text-ink no-underline transition-[filter] duration-200 ease-out hover:brightness-95"
      >
        {t('cta')}
      </Link>
    </section>
  );
}

/** Amber "Needs you" card; hidden when there is nothing to mark. */
export function NeedsYou({ count }: { count: number }) {
  const t = useTranslations('app.today.needsYou');
  if (count <= 0) return null;
  return (
    <Link
      href="/app/outcomes"
      className="flex items-center gap-3 rounded-card-sm border border-warning-line bg-warning-soft p-[18px] text-warning-deep no-underline transition-[filter] duration-200 ease-out hover:brightness-95"
    >
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-[13px] font-semibold tracking-[0.06em] uppercase">{t('eyebrow')}</span>
        <span className="text-lg font-semibold">{t('title', { count })}</span>
      </span>
      <ChevronRight size={22} aria-hidden="true" className="shrink-0 rtl:-scale-x-100" />
    </Link>
  );
}

const typeTone: Record<WaitlistActivity['type'], ChipTone> = {
  CLAIMED: 'success',
  OFFERED: 'amber',
  EXPIRED: 'neutral',
};

function ActivityLine({ item, timezone }: { item: WaitlistActivity; timezone: string }) {
  const t = useTranslations('app.today.waitlist');
  const f = useBookingFormat(timezone);
  const values = {
    name: item.claimedBy?.name ?? '',
    day: f.day(item.slot.startAt),
    time: f.time(item.slot.startAt),
    staff: item.slot.staff.displayName,
    count: item.offeredTo,
  };
  const key = item.type === 'CLAIMED' ? 'claimed' : item.type === 'OFFERED' ? 'offered' : 'expired';
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <Chip tone={typeTone[item.type]}>{t(`type.${key}`)}</Chip>
      <span className="min-w-0 flex-1">{t(`line.${key}`, values)}</span>
    </li>
  );
}

/** Latest waitlist offers/claims. Its own request, so a failure here never hides the day. */
export function WaitlistActivityCard({ timezone }: { timezone: string }) {
  const t = useTranslations('app.today.waitlist');
  const te = useTranslations('app.errors');
  const res = useResource((signal) => getWaitlistActivity(5, signal), 'waitlist');
  usePolling(res.reload);
  return (
    <Card as="section" size="sm" padding="compact" aria-labelledby="waitlist-activity" className="flex flex-col gap-2.5">
      <h2 id="waitlist-activity" className="m-0 text-base font-semibold">
        {t('title')}
      </h2>
      {res.data ? (
        res.data.length === 0 ? (
          <p className="m-0 text-sm text-muted">{t('empty')}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {res.data.map((item) => (
              <ActivityLine key={`${item.offerId}-${item.type}-${item.at}`} item={item} timezone={timezone} />
            ))}
          </ul>
        )
      ) : res.error ? (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="m-0 text-sm text-muted">{te(errorKey(res.error))}</p>
          <Button variant="secondary" size="md" onClick={res.reload}>
            {te('retry')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5" aria-busy="true">
          <Skeleton className="h-6" />
          <Skeleton className="h-6" />
        </div>
      )}
    </Card>
  );
}
