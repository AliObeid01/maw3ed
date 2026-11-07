'use client';

import { RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { ConfirmSheet } from '@/components/app/ConfirmSheet';
import { Bidi, isolate, ltr } from '@/components/ui/Bidi';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { Chip, type ChipTone } from '@/components/ui/Chip';
import { Skeleton } from '@/components/ui/Skeleton';
import { getLink, postLinkAction, type LinkView } from '@/lib/api/links';
import { createSubmitGuard } from '@/lib/auth/submitGuard';
import {
  buttonsFor,
  cancelNoteKind,
  classifyLinkError,
  type LinkAction,
  type LinkFailure,
} from '@/lib/links/state';
import { myBookings, type SavedBooking } from '@/lib/myBookings/storage';
import { formatWhen } from '@/lib/myBookings/viewModel';
import { formatClock } from '@/lib/time/clock';
import type { Live } from './useLiveBookings';

const CANCELLED = new Set(['CANCELLED', 'LATE_CANCEL']);

function DateTile({ month, day }: { month: string; day: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-[68px] w-16 shrink-0 flex-col items-center justify-center rounded-tile border border-line bg-surface"
    >
      <span className="text-xs font-semibold text-brand uppercase">{month}</span>
      <span className="text-2xl leading-tight font-semibold tabular-nums">{day}</span>
    </span>
  );
}

/** The saved summary (business, service with staff, day and time in the business zone, reference). */
function Summary({ entry, chip }: { entry: SavedBooking; chip?: React.ReactNode }) {
  const t = useTranslations('myBookings');
  const locale = useLocale();
  const when = formatWhen(entry.startAt, entry.endAt, entry.timezone, locale);
  return (
    <div className="flex items-start gap-3.5">
      <DateTile month={when.month} day={when.dayOfMonth} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="m-0 text-lg leading-snug font-semibold">
          <Bidi>{entry.businessName}</Bidi>
        </h3>
        <p className="m-0 text-[15px] text-ink">
          {t('with', { service: isolate(entry.serviceName), staff: isolate(entry.staffName) })}
        </p>
        <p className="m-0 text-[15px] text-muted">
          {t('when', { day: when.day, range: ltr(when.range) })}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {chip}
          {entry.reference ? (
            <span className="text-sm text-muted">{t('reference', { code: ltr(entry.reference) })}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function statusChip(status: string): { key: 'booked' | 'confirmed' | 'cancelled' | 'pending'; tone: ChipTone } {
  if (CANCELLED.has(status)) return { key: 'cancelled', tone: 'neutral' };
  if (status === 'CONFIRMED') return { key: 'confirmed', tone: 'brand' };
  if (status === 'PENDING_PAYMENT') return { key: 'pending', tone: 'warning' };
  return { key: 'booked', tone: 'warning' };
}

type ActionProblem = Exclude<LinkFailure, 'invalid' | 'expired'>;

/** An upcoming booking with its live status, Confirm and Cancel (what the link page offers), and a link to the booking page. */
export function UpcomingCard({
  entry,
  state,
  onLink,
  onRetry,
}: {
  entry: SavedBooking;
  /** undefined while the status is being read. */
  state: Live | undefined;
  onLink: (token: string, link: LinkView) => void;
  onRetry: (token: string) => void;
}) {
  const t = useTranslations('myBookings');
  const tl = useTranslations('link');
  const guard = useRef(createSubmitGuard());
  const [pending, setPending] = useState<LinkAction>();
  const [problem, setProblem] = useState<ActionProblem>();
  const [dialog, setDialog] = useState(false);
  const locale = useLocale();

  const link = state?.phase === 'ready' ? state.link : undefined;
  const cancelled = link ? CANCELLED.has(link.appointment.status) : false;
  const chipInfo = link ? statusChip(link.appointment.status) : undefined;
  const buttons = link && !cancelled ? buttonsFor(link) : [];
  const late = link ? cancelNoteKind(link) === 'late' : false;
  const cutoff = link
    ? `${formatWhen(link.cancelCutoffAt, link.cancelCutoffAt, entry.timezone, locale).day}, ${formatClock(link.cancelCutoffAt, entry.timezone)}`
    : '';

  const sheet = {
    title: tl('cancelDialog.title'),
    description: late
      ? tl('cancelDialog.late', { cutoff, name: entry.businessName })
      : tl('cancelDialog.free', { cutoff }),
    yes: tl('cancelDialog.yes'),
    keep: tl('cancelDialog.keep'),
    close: tl('cancelDialog.close'),
  };

  /** Opening the dialog re-reads the appointment so "free" or "late" is current, not as of page load. */
  async function openCancel() {
    setDialog(true);
    try {
      onLink(entry.token, await getLink(entry.token));
    } catch {
      // keep what we have: the dialog still explains the rule from the last answer
    }
  }

  async function run(action: LinkAction) {
    if (!guard.current.tryStart()) return;
    setPending(action);
    setProblem(undefined);
    try {
      const { result, ...next } = await postLinkAction(entry.token, action);
      void result;
      onLink(entry.token, next);
      setDialog(false);
    } catch (error) {
      const kind = classifyLinkError(error);
      setDialog(false);
      if (kind === 'invalid' || kind === 'expired') {
        myBookings.markEnded(entry.token, 'closed'); // quietly moves to Previous visits
      } else {
        setProblem(kind);
        if (kind === 'notAllowed') {
          // 409: it changed under us (cancelled elsewhere): show what it is now.
          try {
            onLink(entry.token, await getLink(entry.token));
          } catch {
            // keep the message
          }
        }
      }
    } finally {
      guard.current.release();
      setPending(undefined);
    }
  }

  return (
    <Card as="li" padding="compact" className="flex flex-col gap-4" data-testid="upcoming-card">
      <Summary
        entry={entry}
        chip={
          chipInfo ? (
            <Chip tone={chipInfo.tone} data-testid="status-chip" className="px-3 py-1.5 text-[13px]">
              {t(`status.${chipInfo.key}`)}
            </Chip>
          ) : state?.phase === 'error' ? null : (
            <Skeleton className="h-[28px] w-24 rounded-chip" data-testid="status-loading" />
          )
        }
      />

      {state === undefined ? <span className="sr-only">{t('status.checking')}</span> : null}

      {state?.phase === 'error' ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-card-sm bg-warning-soft p-3.5 text-[15px] text-ink"
        >
          <span className="font-semibold">{t('refresh.failed')}</span>
          <Button variant="secondary" onClick={() => onRetry(entry.token)}>
            <RefreshCw size={16} aria-hidden="true" />
            {t('refresh.retry')}
          </Button>
        </div>
      ) : null}

      {problem ? (
        <div role="alert">
          <Callout tone="danger">{tl(`errors.${problem}`)}</Callout>
        </div>
      ) : null}

      {buttons.length > 0 ? (
        <div role="group" aria-label={t('manage')} className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {buttons.map(({ action, primary }) => (
            <Button
              key={action}
              size="row"
              block
              variant={action === 'cancel' ? 'danger' : primary ? 'primary' : 'secondary'}
              loading={pending === action && action === 'confirm'}
              disabled={pending !== undefined && pending !== action}
              onClick={() => (action === 'confirm' ? void run('confirm') : void openCancel())}
            >
              {t(`actions.${action}`)}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="flex">
        <ButtonLink
          href={`/b/${encodeURIComponent(entry.slug)}`}
          variant="ghost"
          size="row"
          className="-ms-3 ps-3"
        >
          {cancelled ? t('actions.again') : t('actions.view')}
        </ButtonLink>
      </div>

      <ConfirmSheet
        open={dialog}
        onOpenChange={(open) => !pending && setDialog(open)}
        title={sheet.title}
        description={sheet.description}
        confirmLabel={sheet.yes}
        cancelLabel={sheet.keep}
        closeLabel={sheet.close}
        pending={pending === 'cancel'}
        onConfirm={() => void run('cancel')}
      />
    </Card>
  );
}

/** A previous visit from the local summary only: never a status or an outcome the business recorded. */
export function PastCard({ entry }: { entry: SavedBooking }) {
  const t = useTranslations('myBookings');
  return (
    <Card as="li" padding="compact" className="flex flex-col gap-3" data-testid="past-card">
      <Summary
        entry={entry}
        chip={
          entry.ended === 'cancelled' ? (
            <Chip tone="neutral" className="px-3 py-1.5 text-[13px]">
              {t('status.cancelled')}
            </Chip>
          ) : undefined
        }
      />
      <div className="flex">
        <ButtonLink
          href={`/b/${encodeURIComponent(entry.slug)}`}
          variant="ghost"
          size="row"
          className="-ms-3 ps-3"
        >
          {t('actions.again')}
        </ButtonLink>
      </div>
    </Card>
  );
}
