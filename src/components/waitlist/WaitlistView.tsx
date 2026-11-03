'use client';

import { Hourglass } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { ConfirmSheet } from '@/components/app/ConfirmSheet';
import { useAppSession } from '@/components/app/SessionContext';
import { EmptyState, LoadError, useErrorMessage, useSharedText } from '@/components/app/states';
import { useBookingFormat } from '@/components/booking/useBookingFormat';
import { WaitlistActivityCard } from '@/components/dashboard/SideCards';
import { Bidi, isolate, MetaLine } from '@/components/ui/Bidi';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api/auth';
import { useResource } from '@/lib/api/useResource';
import {
  getWaitlistEntries,
  removeWaitlistEntry,
  type WaitlistEntry,
  type WaitlistList,
} from '@/lib/api/waitlist';

/** Puts a removed row back where it was (oldest first, ties by id) when the server refused. */
function reinsert(list: WaitlistList | undefined, entry: WaitlistEntry): WaitlistList {
  const base = list ?? { entries: [], total: 0 };
  if (base.entries.some((e) => e.id === entry.id)) return base;
  const entries = [...base.entries, entry].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  return { entries, total: base.total + 1 };
}

function Skeletons() {
  const t = useTranslations('app.waitlist');
  return (
    <Card padding="none" className="overflow-hidden" aria-busy="true" aria-label={t('loading')} role="status">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2 border-b border-row p-4 last:border-b-0">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-11 w-24" />
        </div>
      ))}
    </Card>
  );
}

function Row({
  entry,
  timezone,
  onRemove,
}: {
  entry: WaitlistEntry;
  timezone: string;
  onRemove: (entry: WaitlistEntry) => void;
}) {
  const t = useTranslations('app.waitlist');
  const f = useBookingFormat(timezone);
  const name = entry.client.firstName;
  const dates =
    entry.fromDate === entry.toDate
      ? f.ymd(entry.fromDate)
      : t('dates', { from: f.ymd(entry.fromDate), to: f.ymd(entry.toDate) });
  return (
    <li className="flex flex-col gap-3 border-b border-row p-4 last:border-b-0 md:grid md:grid-cols-[1.3fr_1.4fr_1.4fr_auto] md:items-center md:gap-4 md:px-[22px] md:py-3.5">
      <span className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-pill bg-brand-avatar text-[13px] font-semibold text-brand"
        >
          {Array.from(name)[0]?.toUpperCase()}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-start font-semibold">
            <Bidi>{name}</Bidi>
          </span>
          <Bidi dir="ltr" className="text-[13px] text-muted">
            {entry.client.phone}
          </Bidi>
        </span>
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 text-[15px]">
        <MetaLine
          items={[
            <Bidi key="s">{entry.service.name}</Bidi>,
            entry.staff ? <Bidi key="st">{entry.staff.displayName}</Bidi> : t('anyone'),
          ]}
        />
        <span className="text-sm text-muted">{dates}</span>
      </span>
      <span className="text-sm text-muted">{t('joined', { date: f.day(entry.createdAt) })}</span>
      <Button
        variant="secondary"
        aria-label={t('removeAria', { name })}
        onClick={() => onRemove(entry)}
        className="self-end md:self-auto"
      >
        {t('remove')}
      </Button>
    </li>
  );
}

/**
 * Waitlist screen (F65): everyone waiting for a slot (OPEN entries, oldest first, the order offers are sent), a
 * Remove action behind a confirmation, and the latest offers and claims below. The server sends only a first name
 * and a masked phone; this screen never has an email or a full number to show.
 */
export function WaitlistView() {
  const t = useTranslations('app.waitlist');
  const { timezone } = useAppSession();
  const toast = useToast();
  const errorText = useErrorMessage();
  const shared = useSharedText();
  const res = useResource((signal) => getWaitlistEntries(signal), 'waitlist-entries');
  const [target, setTarget] = useState<WaitlistEntry | null>(null);
  const [open, setOpen] = useState(false);
  // Entries whose removal is in flight: a second tap on the same one is ignored.
  const removing = useRef(new Set<string>());

  const entries = res.data?.entries ?? [];
  const total = res.data?.total ?? 0;

  const ask = (entry: WaitlistEntry) => {
    if (open || removing.current.has(entry.id)) return;
    setTarget(entry);
    setOpen(true);
  };

  const confirm = () => {
    const current = target;
    if (!current || removing.current.has(current.id)) return;
    removing.current.add(current.id);
    setOpen(false);
    // Optimistic: the row goes now; a failure puts it back, a 404 (already gone) just refreshes the list.
    res.setData((c) =>
      c
        ? {
            entries: c.entries.filter((e) => e.id !== current.id),
            total: Math.max(0, c.total - 1),
          }
        : { entries: [], total: 0 },
    );
    removeWaitlistEntry(current.id)
      .then(() => toast.show(t('removed', { name: isolate(current.client.firstName) })))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) {
          res.reload();
          return;
        }
        res.setData((c) => reinsert(c, current));
        toast.show(errorText(error), 'error');
      })
      .finally(() => removing.current.delete(current.id));
  };

  return (
    <>
      <p className="m-0 max-w-[760px] text-[15px] leading-normal text-muted">{t('intro')}</p>

      {res.error && !res.data ? (
        <LoadError error={res.error} onRetry={res.reload} />
      ) : !res.data ? (
        <Skeletons />
      ) : (
        <section aria-labelledby="waitlist-list-title" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="waitlist-list-title" className="m-0 text-lg font-semibold">
              {t('listTitle')}
            </h2>
            <p role="status" aria-live="polite" className="m-0 text-sm font-medium text-muted">
              {t('summary', { count: total })}
            </p>
          </div>
          {res.error ? (
            <p role="status" className="m-0 text-sm text-muted">
              {t('stale')}
            </p>
          ) : null}
          {entries.length === 0 ? (
            <EmptyState icon={<Hourglass size={22} />} title={t('emptyTitle')} body={t('emptyBody')} />
          ) : (
            <Card padding="none" className="overflow-hidden">
              <ul aria-label={t('listLabel')} className="m-0 flex list-none flex-col p-0">
                {entries.map((entry) => (
                  <Row key={entry.id} entry={entry} timezone={timezone} onRemove={ask} />
                ))}
              </ul>
            </Card>
          )}
          {total > entries.length ? (
            <p className="m-0 text-sm text-muted">
              {t('capNote', { shown: entries.length, total })}
            </p>
          ) : null}
        </section>
      )}

      <WaitlistActivityCard timezone={timezone} limit={10} showLink={false} />

      <ConfirmSheet
        open={open}
        onOpenChange={setOpen}
        title={t('confirm.title', { name: isolate(target?.client.firstName ?? '') })}
        description={t('confirm.body', { name: isolate(target?.client.firstName ?? '') })}
        confirmLabel={t('confirm.confirm')}
        cancelLabel={shared.cancel}
        closeLabel={t('close')}
        onConfirm={confirm}
      />
    </>
  );
}
