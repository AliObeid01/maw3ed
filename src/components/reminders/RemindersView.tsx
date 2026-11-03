'use client';

import { Bidi, MetaLine } from '@/components/ui/Bidi';
import { Check, CircleAlert, MessageCircle, PhoneOff } from 'lucide-react';
import { useReducer, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { HeaderActions } from '@/components/app/HeaderActions';
import { NoShowBadge } from '@/components/app/NoShowBadge';
import { useAppSession } from '@/components/app/SessionContext';
import { EmptyState, LoadError, useErrorMessage } from '@/components/app/states';
import { useSummary } from '@/components/app/SummaryContext';
import { usePolling } from '@/components/app/usePolling';
import { useBookingFormat } from '@/components/booking/useBookingFormat';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusChip } from '@/components/ui/Chip';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  alreadySentFrom,
  getWhatsappDue,
  markReminderSent,
  type ReminderItem,
} from '@/lib/api/reminders';
import { useResource } from '@/lib/api/useResource';
import { dayRelation } from '@/lib/dashboard/agenda';
import { formatPhone, telUrl } from '@/lib/dashboard/phone';
import { isRepeatNoShow } from '@/lib/clientFlags';
import {
  deriveReminder,
  idleMark,
  markReducer,
  pendingCount,
  sortReminders,
  type LocalMark,
  type MarkEvent,
  type ReminderView,
} from '@/lib/reminders/state';
import { cn } from '@/lib/cn';

type Marks = Record<string, LocalMark>;
const marksReducer = (state: Marks, action: { id: string; event: MarkEvent }): Marks => ({
  ...state,
  [action.id]: markReducer(state[action.id] ?? idleMark, action.event),
});

const sendClass =
  'inline-flex h-[46px] w-full items-center justify-center gap-2 rounded-btn bg-electric px-5 text-[15px] font-semibold text-white no-underline transition-colors duration-200 ease-out hover:bg-brand-hover';

/** Everything for one reminder row that both layouts share. */
function useRowText(item: ReminderItem, timezone: string) {
  const t = useTranslations('app.remindersDue');
  const f = useBookingFormat(timezone);
  const relation = dayRelation(item.appointment.startAt, timezone);
  const day =
    relation === 'today'
      ? t('today')
      : relation === 'tomorrow'
        ? t('tomorrow')
        : f.day(item.appointment.startAt);
  return {
    when: (
      <>
        {day} <bdi dir="ltr">{f.time(item.appointment.startAt)}</bdi>
      </>
    ),
    what: (
      <MetaLine
        items={[
          <Bidi key="s">{item.appointment.service.name}</Bidi>,
          <Bidi key="p">{item.appointment.staff.displayName}</Bidi>,
        ]}
      />
    ),
    time: f.time,
  };
}

/**
 * Board 4.2 "done" state: the WhatsApp action stays in place as a disabled button that carries who sent it and when
 * (business timezone, 24-hour). The change is announced by the ONE persistent live region of the view (a region that mounts together with
 * its content is often not announced); the visible text is the button's accessible name.
 */
function SentButton({
  view,
  timezone,
  userName,
}: {
  view: Extract<ReminderView, { kind: 'sent' | 'sending' }>;
  timezone: string;
  userName: string;
}) {
  const t = useTranslations('app.remindersDue');
  const f = useBookingFormat(timezone);
  const name = view.kind === 'sending' ? userName : (view.by?.name ?? t('someone'));
  const at = view.kind === 'sending' ? null : view.at;
  const tags = {
    who: (chunks: ReactNode) => <Bidi>{chunks}</Bidi>,
    clock: (chunks: ReactNode) => <Bidi dir="ltr">{chunks}</Bidi>,
  };
  const label = at
    ? t.rich('sentBy', { ...tags, name, time: f.time(at) })
    : view.kind === 'sending'
      ? t.rich('sentByYou', { ...tags, name })
      : t.rich('sentByNoTime', { ...tags, name });
  return (
    <div className="flex">
      <button
        type="button"
        disabled
        aria-disabled="true"
        className={buttonClasses({
          variant: 'secondary',
          size: 'row',
          block: true,
          className:
            'border-dashed bg-surface text-muted hover:bg-surface disabled:cursor-default disabled:opacity-100 aria-disabled:cursor-default aria-disabled:opacity-100',
        })}
      >
        <Check size={16} strokeWidth={2.5} aria-hidden="true" className="shrink-0 text-success" />
        <span className="min-w-0 truncate text-sm">{label}</span>
      </button>
    </div>
  );
}

function ActionCell({
  item,
  view,
  timezone,
  userName,
  onSend,
  onRetry,
}: {
  item: ReminderItem;
  view: ReminderView;
  timezone: string;
  userName: string;
  onSend: (item: ReminderItem, event: MouseEvent<HTMLAnchorElement>) => void;
  onRetry: (item: ReminderItem) => void;
}) {
  const t = useTranslations('app.remindersDue');
  switch (view.kind) {
    case 'pending':
      return (
        <a
          href={item.whatsappUrl ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => onSend(item, e)}
          aria-label={t('sendAria', { name: item.client.name })}
          className={sendClass}
        >
          <MessageCircle size={18} aria-hidden="true" />
          {t('send')}
        </a>
      );
    case 'sending':
    case 'sent':
      return <SentButton view={view} timezone={timezone} userName={userName} />;
    case 'retry':
      return (
        <div role="alert" className="flex flex-col gap-2">
          <p className="m-0 flex items-start gap-2 rounded-2xl border border-warning-line bg-warning-soft p-3 text-sm text-warning-deep">
            <CircleAlert size={18} aria-hidden="true" className="mt-px shrink-0" />
            {t('retryBody')}
          </p>
          <Button variant="secondary" size="row" block onClick={() => onRetry(item)}>
            {t('retryCta')}
          </Button>
        </div>
      );
    case 'noPhone':
      return (
        <div className="flex flex-col items-center gap-1 text-center text-sm text-muted">
          <span className="flex items-center gap-1.5">
            <PhoneOff size={16} aria-hidden="true" />
            {t('noPhone')}
          </span>
          {telUrl(item.client.phone) ? (
            <a
              href={telUrl(item.client.phone) ?? undefined}
              className="inline-flex min-h-11 items-center text-brand underline"
            >
              {t('callInstead')}
            </a>
          ) : null}
        </div>
      );
  }
}

function ClientCell({ item }: { item: ReminderItem }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
        {item.client.name}
        {isRepeatNoShow(item.client.noShows) ? <NoShowBadge count={item.client.noShows} /> : null}
      </span>
      <span className="text-[13px] text-muted">
        <bdi dir="ltr">{formatPhone(item.client.phone)}</bdi>
      </span>
    </span>
  );
}

function ReminderChip({ kind }: { kind: ReminderItem['kind'] }) {
  return <StatusChip status={kind === 'H2' ? 'reminder2h' : 'reminder24h'} />;
}

function Skeletons() {
  const t = useTranslations('app.remindersDue');
  return (
    <div className="flex flex-col gap-3" role="status" aria-busy="true" aria-label={t('loading')}>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-[148px] rounded-card md:h-[72px]" />
      ))}
    </div>
  );
}

/** Board 4.2: WhatsApp reminders to send now. Table from `md`, stacked cards on phones. */
export function RemindersView() {
  const t = useTranslations('app.remindersDue');
  const { timezone, userName } = useAppSession();
  const errorMessage = useErrorMessage();
  const { refresh: refreshSummary, setWhatsappDue } = useSummary();
  const [marks, dispatch] = useReducer(marksReducer, {});
  const busy = useRef(new Set<string>());
  const f = useBookingFormat(timezone);
  // F56: ONE live region that is always mounted; its text changes when a row flips to sent.
  const [announcement, setAnnouncement] = useState('');
  const plain = { who: (c: string) => c, clock: (c: string) => c };
  const announce = (item: ReminderItem, text: string) =>
    setAnnouncement(t('announce', { name: item.client.name, text }));

  const res = useResource((signal) => getWhatsappDue(signal), 'due');
  usePolling(res.reload);

  const record = async (item: ReminderItem) => {
    if (busy.current.has(item.id)) return;
    busy.current.add(item.id);
    try {
      const result = await markReminderSent(item.id);
      dispatch({ id: item.id, event: { type: 'ok', by: result.sentBy, at: result.sentAt } });
    } catch (error) {
      const first = alreadySentFrom(error);
      if (first) {
        dispatch({ id: item.id, event: { type: 'conflict', by: first.sentBy, at: first.sentAt } });
        const who = first.sentBy?.name ?? t('someone');
        announce(
          item,
          first.sentAt
            ? t.markup('sentBy', { ...plain, name: who, time: f.time(first.sentAt) })
            : t.markup('sentByNoTime', { ...plain, name: who }),
        );
      } else {
        errorMessage(error); // a 401 sends the user to sign in
        dispatch({ id: item.id, event: { type: 'fail' } });
      }
    } finally {
      busy.current.delete(item.id);
      refreshSummary();
    }
  };

  const onSend = (item: ReminderItem, event: MouseEvent<HTMLAnchorElement>) => {
    // A second tap while the first is being recorded must not open WhatsApp again.
    const state = marks[item.id] ?? idleMark;
    if (state.phase !== 'idle' || busy.current.has(item.id)) {
      event.preventDefault();
      return;
    }
    dispatch({ id: item.id, event: { type: 'tap' } });
    announce(item, t.markup('sentByYou', { ...plain, name: userName }));
    setWhatsappDue(Math.max(0, pendingCount(res.data?.items ?? [], marks) - 1));
    void record(item);
  };

  const onRetry = (item: ReminderItem) => {
    dispatch({ id: item.id, event: { type: 'retry' } });
    void record(item);
  };

  const items = res.data ? sortReminders(res.data.items) : [];
  const toSend = res.data ? pendingCount(res.data.items, marks) : 0;

  const counter = res.data ? (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        'rounded-btn px-3 py-1.5 text-sm font-semibold whitespace-nowrap',
        toSend > 0 ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success',
      )}
    >
      {toSend > 0 ? t('toSend', { count: toSend }) : t('allDone')}
    </span>
  ) : null;

  return (
    <>
      <HeaderActions>{counter}</HeaderActions>
      <div role="status" aria-live="polite" aria-atomic="true" data-testid="reminder-announcer" className="sr-only">
        {announcement}
      </div>
      <p className="m-0 max-w-[760px] text-[15px] leading-normal text-muted">{t('intro')}</p>
      {res.error && !res.data ? (
        <LoadError error={res.error} onRetry={res.reload} />
      ) : !res.data ? (
        <Skeletons />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Check size={22} />}
          title={t('emptyTitle')}
          body={t('emptyBody')}
        />
      ) : (
        <>
          {res.error ? (
            <p role="status" className="m-0 text-sm text-muted">
              {t('stale')}
            </p>
          ) : null}
          <Card as="section" padding="none" aria-label={t('listLabel')} className="overflow-hidden">
            <div
              aria-hidden="true"
              className="hidden grid-cols-[1.6fr_1.6fr_0.8fr_220px] gap-3 border-b border-row px-[22px] py-3.5 text-[13px] font-semibold tracking-[0.04em] text-muted uppercase md:grid"
            >
              <span>{t('col.client')}</span>
              <span>{t('col.appointment')}</span>
              <span>{t('col.reminder')}</span>
              <span />
            </div>
            <ul className="m-0 flex list-none flex-col p-0">
              {items.map((item) => (
                <Row
                  key={item.id}
                  item={item}
                  view={deriveReminder(item, marks[item.id])}
                  timezone={timezone}
                  userName={userName}
                  onSend={onSend}
                  onRetry={onRetry}
                />
              ))}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}

function Row({
  item,
  view,
  timezone,
  userName,
  onSend,
  onRetry,
}: {
  item: ReminderItem;
  view: ReminderView;
  timezone: string;
  userName: string;
  onSend: (item: ReminderItem, event: MouseEvent<HTMLAnchorElement>) => void;
  onRetry: (item: ReminderItem) => void;
}) {
  const text = useRowText(item, timezone);
  const done = view.kind === 'sent' || view.kind === 'sending';
  return (
    <li
      aria-busy={view.kind === 'sending' || undefined}
      className={cn(
        'flex flex-col gap-3 border-b border-row p-4 last:border-b-0 md:grid md:grid-cols-[1.6fr_1.6fr_0.8fr_220px] md:items-center md:gap-3 md:px-[22px] md:py-3',
        done && 'bg-canvas text-muted',
      )}
    >
      <ClientCell item={item} />
      <span className="flex flex-col gap-0.5 text-[15px]">
        <span>{text.when}</span>
        <span className="text-sm text-muted">{text.what}</span>
      </span>
      <span>
        <ReminderChip kind={item.kind} />
      </span>
      <ActionCell
        item={item}
        view={view}
        timezone={timezone}
        userName={userName}
        onSend={onSend}
        onRetry={onRetry}
      />
    </li>
  );
}
