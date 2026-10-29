'use client';

import { ChevronLeft, TriangleAlert, UserX } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { HeaderActions } from '@/components/app/HeaderActions';
import { useAppSession } from '@/components/app/SessionContext';
import { EmptyState, LoadError, useErrorMessage } from '@/components/app/states';
import { useBookingFormat } from '@/components/booking/useBookingFormat';
import { chipTone, toneLabelKey } from '@/components/dashboard/apptStyles';
import { Button, ButtonLink, buttonClasses } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatTile } from '@/components/ui/StatTile';
import { useToast } from '@/components/ui/Toast';
import { deleteClient, getClient, type ClientDetail, type HistoryItem } from '@/lib/api/outcomes';
import { useResource } from '@/lib/api/useResource';
import { apptTone } from '@/lib/dashboard/agenda';
import { formatPhone, initials, telUrl } from '@/lib/dashboard/phone';
import { errorKey } from '@/lib/setup/errors';

/** The API returns the latest 50 appointments. */
const HISTORY_LIMIT = 50;

function Skeletons() {
  const t = useTranslations('app.clientHistory');
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('loading')}
      className="flex flex-col gap-4 lg:grid lg:grid-cols-[300px_minmax(0,1fr)]"
    >
      <Skeleton className="h-[210px] rounded-card" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-[92px] rounded-tile" />
        <Skeleton className="h-[260px] rounded-card" />
      </div>
    </div>
  );
}

function HistoryRow({ item: h, timezone }: { item: HistoryItem; timezone: string }) {
  const t = useTranslations('app.clientHistory');
  const ts = useTranslations('ui.status');
  const f = useBookingFormat(timezone);
  const tone = apptTone({ status: h.status, source: '' });
  const statusKey = toneLabelKey[tone === 'waitlist' ? 'booked' : tone];
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-row px-5 py-3.5 last:border-b-0">
      <Link
        href={`/app/appointments/${h.id}`}
        aria-label={t('openAppointmentAria', { day: f.day(h.startAt), time: f.time(h.startAt) })}
        className="min-w-0 flex-[1_1_220px] text-[15px] text-ink no-underline hover:underline"
      >
        <span className="font-semibold">{f.day(h.startAt)}</span>
        {' · '}
        <bdi dir="ltr" className="font-semibold tabular-nums">
          {f.time(h.startAt)}
        </bdi>
        {' · '}
        {h.service.name} · {h.staff.displayName}
      </Link>
      <Chip tone={chipTone[tone]}>{ts(statusKey)}</Chip>
    </li>
  );
}

function History({ data, timezone }: { data: ClientDetail; timezone: string }) {
  const t = useTranslations('app.clientHistory');
  return (
    <Card as="section" padding="none" aria-labelledby="client-history" className="overflow-hidden">
      <h2 id="client-history" className="m-0 border-b border-row px-5 py-4 text-lg font-semibold">
        {t('historyTitle')}
      </h2>
      {data.history.length === 0 ? (
        <p className="m-0 px-5 py-8 text-center text-sm text-muted">{t('historyEmpty')}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {data.history.map((h) => (
            <HistoryRow key={h.id} item={h} timezone={timezone} />
          ))}
        </ul>
      )}
      {data.history.length >= HISTORY_LIMIT ? (
        <p className="m-0 border-t border-row px-5 py-3 text-[13px] text-muted">
          {t('historyLimit', { count: HISTORY_LIMIT })}
        </p>
      ) : null}
    </Card>
  );
}

/** Board 4.7: one client's counters and latest appointments. Owners can delete (anonymise) the client. */
export function ClientHistoryView({ id }: { id: string }) {
  const t = useTranslations('app.clientHistory');
  const tc = useTranslations('app.clients');
  const { timezone, role } = useAppSession();
  const router = useRouter();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const res = useResource((signal) => getClient(id, signal), id);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();
  const busy = useRef(false);

  const back = (
    <IconButton label={t('back')} onClick={() => router.push('/app/clients')} className="self-start">
      <ChevronLeft size={20} aria-hidden="true" className="rtl:-scale-x-100" />
    </IconButton>
  );

  if (res.error && !res.data) {
    if (errorKey(res.error) === 'notFound') {
      return (
        <>
          {back}
          <EmptyState
            icon={<UserX size={22} />}
            title={t('notFoundTitle')}
            body={t('notFoundBody')}
            action={
              <ButtonLink href="/app/clients" variant="secondary">
                {t('backToClients')}
              </ButtonLink>
            }
          />
        </>
      );
    }
    return (
      <>
        {back}
        <LoadError error={res.error} onRetry={res.reload} />
      </>
    );
  }
  if (!res.data) {
    return (
      <>
        {back}
        <Skeletons />
      </>
    );
  }

  const { client } = res.data;
  const isOwner = role === 'OWNER';
  const labels = {
    attended: tc('col.attended'),
    noShows: tc('col.noShows'),
    lateCancels: tc('col.lateCancels'),
  };

  const remove = async () => {
    if (busy.current) return;
    busy.current = true;
    setDeleting(true);
    setError(undefined);
    try {
      await deleteClient(client.id);
      setConfirming(false);
      toast.show(t('deletedToast', { name: client.name }));
      router.replace('/app/clients');
    } catch (e) {
      setError(errorMessage(e));
      setDeleting(false);
    } finally {
      busy.current = false;
    }
  };

  return (
    <>
      <HeaderActions>
        <Link href="/app/book" className={buttonClasses({ variant: 'primary', size: 'md' })}>
          {t('bookAgain')}
        </Link>
      </HeaderActions>
      {back}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start lg:gap-x-5">
        <div className="flex flex-col gap-3">
          <Card
            as="section"
            aria-label={t('contactLabel')}
            className="flex flex-col items-center gap-1.5 p-6 text-center md:p-6"
          >
            <span
              aria-hidden="true"
              className={
                client.repeatNoShow
                  ? 'mb-2 flex size-[72px] items-center justify-center rounded-pill bg-danger-soft text-2xl font-semibold text-danger'
                  : 'mb-2 flex size-[72px] items-center justify-center rounded-pill bg-brand-avatar text-2xl font-semibold text-brand'
              }
            >
              {initials(client.name)}
            </span>
            <span className="text-xl font-semibold">{client.name}</span>
            <a
              href={telUrl(client.phone) ?? undefined}
              className="inline-flex min-h-11 items-center text-[15px] text-muted no-underline hover:underline"
            >
              <bdi dir="ltr">{formatPhone(client.phone)}</bdi>
            </a>
            {client.email ? (
              <a
                href={`mailto:${client.email}`}
                className="inline-flex min-h-11 max-w-full items-center text-[15px] break-all text-muted no-underline hover:underline"
              >
                <bdi dir="ltr">{client.email}</bdi>
              </a>
            ) : null}
          </Card>
          {client.repeatNoShow ? (
            <Callout tone="danger" icon={<TriangleAlert />} className="rounded-[18px]">
              {t('repeatNote')}
            </Callout>
          ) : null}
          {isOwner ? (
            <div className="flex justify-center">
              <Button
                variant="ghost"
                onClick={() => setConfirming(true)}
                className="font-medium text-danger hover:bg-danger-soft"
              >
                {t('delete')}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <div role="group" aria-label={t('countersLabel')} className="grid grid-cols-3 gap-2 md:gap-4">
            <StatTile value={client.attended} label={labels.attended} tone="success" />
            <StatTile value={client.noShows} label={labels.noShows} tone="danger" />
            <StatTile value={client.lateCancels} label={labels.lateCancels} tone="amber" />
          </div>
          <History data={res.data} timezone={timezone} />
        </div>
      </div>

      <Sheet
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !deleting) {
            setConfirming(false);
            setError(undefined);
          }
        }}
        title={t('deleteTitle', { name: client.name })}
        description={t('deleteBody')}
        closeLabel={t('close')}
      >
        <div className="flex flex-col gap-3">
          {error ? (
            <p role="alert" className="m-0 text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}
          <Button variant="danger" size="lg" block loading={deleting} onClick={remove}>
            {t('deleteConfirm')}
          </Button>
          <Button variant="secondary" size="lg" block disabled={deleting} onClick={() => setConfirming(false)}>
            {t('deleteKeep')}
          </Button>
        </div>
      </Sheet>
    </>
  );
}
