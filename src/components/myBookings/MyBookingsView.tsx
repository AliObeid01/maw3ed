'use client';

import { CalendarClock, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmSheet } from '@/components/app/ConfirmSheet';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { myBookings } from '@/lib/myBookings/storage';
import { splitBookings } from '@/lib/myBookings/viewModel';
import { PastCard, UpcomingCard } from './BookingCards';
import { useLiveBookings } from './useLiveBookings';
import { useMounted, useSavedBookings, useStorageAvailability } from './useSavedBookings';

/** The list area: a skeleton of the same rough size until the browser has read the saved bookings (no flash of "empty"). */
export function MyBookingsView() {
  const mounted = useMounted();
  return mounted ? <Loaded /> : <ListSkeleton />;
}

function ListSkeleton() {
  const t = useTranslations('myBookings');
  return (
    <div aria-hidden="false" data-testid="my-bookings-skeleton" className="grid gap-3.5">
      <p role="status" className="sr-only">
        {t('loading')}
      </p>
      <Skeleton className="h-[188px] rounded-card-sm" />
      <Skeleton className="h-[188px] rounded-card-sm" />
    </div>
  );
}

function Loaded() {
  const t = useTranslations('myBookings');
  const entries = useSavedBookings();
  const availability = useStorageAvailability();
  // "Now" for this page view. The list is empty on the server, so it never differs from what was rendered there.
  const [now] = useState(() => new Date());
  const upcomingTokens = splitBookings(entries, now).upcoming.map((e) => e.token);
  const { live, pinned, apply, retry } = useLiveBookings(upcomingTokens);
  const { upcoming, past } = splitBookings(entries, now, pinned);
  const [forgetOpen, setForgetOpen] = useState(false);

  return (
    <div className="grid grid-cols-1 gap-8">
      {availability === 'blocked' ? (
        <div role="status" data-testid="storage-blocked">
          <Callout tone="warning" icon={<ShieldAlert />}>
            <b className="block font-semibold">{t('blocked.title')}</b>
            {t('blocked.body')}
          </Callout>
        </div>
      ) : null}

      {entries.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-10 text-center" data-testid="my-bookings-empty">
          <span
            aria-hidden="true"
            className="flex size-14 items-center justify-center rounded-[18px] bg-brand-soft text-brand"
          >
            <CalendarClock size={26} />
          </span>
          <h2 className="m-0 text-xl font-semibold">{t('empty.title')}</h2>
          <p className="m-0 max-w-sm text-[15px] text-muted">{t('empty.body')}</p>
          <ButtonLink href="/directory" size="row" className="mt-1">
            {t('empty.explore')}
          </ButtonLink>
        </Card>
      ) : (
        <>
          <section aria-labelledby="mb-upcoming" className="grid grid-cols-1 gap-3.5">
            <h2 id="mb-upcoming" className="m-0 text-xl font-semibold">
              {t('upcoming.title')}
            </h2>
            {upcoming.length > 0 ? (
              <ul className="m-0 grid list-none grid-cols-1 gap-3.5 p-0 lg:grid-cols-2">
                {upcoming.map((entry) => (
                  <UpcomingCard
                    key={entry.token}
                    entry={entry}
                    state={live[entry.token]}
                    onLink={apply}
                    onRetry={retry}
                  />
                ))}
              </ul>
            ) : (
              <p className="m-0 text-[15px] text-muted">{t('upcoming.none')}</p>
            )}
          </section>

          {past.length > 0 ? (
            <section aria-labelledby="mb-past" className="grid grid-cols-1 gap-3.5">
              <h2 id="mb-past" className="m-0 text-xl font-semibold">
                {t('past.title')}
              </h2>
              <ul className="m-0 grid list-none grid-cols-1 gap-3.5 p-0 lg:grid-cols-2">
                {past.map((entry) => (
                  <PastCard key={entry.token} entry={entry} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      <section aria-labelledby="mb-privacy">
        <Card size="sm" padding="compact" className="flex flex-col gap-3 bg-canvas">
          <h2 id="mb-privacy" className="m-0 flex items-center gap-2 text-base font-semibold">
            <ShieldCheck size={20} aria-hidden="true" className="text-brand" />
            {t('privacy.title')}
          </h2>
          <p className="m-0 text-[15px] text-muted">{t('privacy.body')}</p>
          <p className="m-0 text-[15px] text-muted">{t('privacy.shared')}</p>
          {entries.length > 0 ? (
            <div className="flex">
              <Button variant="secondary" size="row" onClick={() => setForgetOpen(true)} aria-haspopup="dialog">
                <Trash2 size={18} aria-hidden="true" />
                {t('forget.button')}
              </Button>
            </div>
          ) : null}
        </Card>
      </section>

      <ConfirmSheet
        open={forgetOpen}
        onOpenChange={setForgetOpen}
        title={t('forget.title')}
        description={t('forget.body')}
        confirmLabel={t('forget.confirm')}
        cancelLabel={t('forget.keep')}
        closeLabel={t('forget.close')}
        onConfirm={() => {
          myBookings.clear();
          setForgetOpen(false);
        }}
      />
    </div>
  );
}
