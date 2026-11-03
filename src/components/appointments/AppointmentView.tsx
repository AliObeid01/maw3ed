'use client';

import { CalendarX2, ChevronLeft, MessageCircle, Phone } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { NoShowBadge } from '@/components/app/NoShowBadge';
import { useAppSession } from '@/components/app/SessionContext';
import { EmptyState, LoadError, useErrorMessage } from '@/components/app/states';
import { useSummary } from '@/components/app/SummaryContext';
import { useBookingFormat } from '@/components/booking/useBookingFormat';
import { OutcomeButtons } from '@/components/outcomes/OutcomeButtons';
import { useFailureText } from '@/components/outcomes/useFailureText';
import { Bidi, MetaLine, TimeRange, isolate } from '@/components/ui/Bidi';
import { Button, buttonClasses, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { cancelAppointment } from '@/lib/api/dashboard';
import { getAppointment, markOutcome, type AppointmentDetail, type Outcome } from '@/lib/api/outcomes';
import { errorKey } from '@/lib/setup/errors';
import { useResource } from '@/lib/api/useResource';
import { apptTone, dayRelation } from '@/lib/dashboard/agenda';
import { formatPhone, initials, isDeletedClient, telUrl, whatsappChatUrl } from '@/lib/dashboard/phone';
import { useClientLabel } from '@/components/app/useClientLabel';
import { outcomeOptions, type OutcomeOptions } from '@/lib/outcomes/eligibility';
import { outcomeFailure, type OutcomeFailure } from '@/lib/outcomes/state';
import { toneLabelKey } from '@/components/dashboard/apptStyles';

const statusKey = { ATTENDED: 'attended', NO_SHOW: 'noShow', LATE_CANCEL: 'lateCancel' } as const;

/** A clock that re-reads every `ms`, so "can I mark it yet?" flips on its own while the page stays open. */
function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** The client's name block: a link to their history, or plain text when there is no page to open. */
function ClientHead({
  href,
  ariaLabel,
  children,
}: {
  href: string | null;
  ariaLabel: string;
  children: ReactNode;
}) {
  const cls = 'flex min-w-[180px] flex-[1_1_180px] flex-col gap-0.5 text-ink no-underline';
  return href ? (
    <Link href={href} aria-label={ariaLabel} className={cls}>
      {children}
    </Link>
  ) : (
    <div className={cls}>{children}</div>
  );
}

function Skeletons() {
  const t = useTranslations('app.appointment');
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('loading')}
      className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px]"
    >
      <Skeleton className="h-[190px] rounded-card" />
      <Skeleton className="h-[150px] rounded-card lg:col-start-2 lg:row-span-3 lg:row-start-1" />
      <Skeleton className="h-[90px] rounded-card-sm" />
    </div>
  );
}

function OutcomeCard({
  appt,
  options,
  timezone,
  onMarked,
  onStale,
  clientName,
}: {
  appt: AppointmentDetail;
  options: Extract<OutcomeOptions, { open: true }>;
  timezone: string;
  onMarked: (status: string) => void;
  /** The server disagreed with what this page showed (409 CONFLICT / NOT_STARTED): reload the truth. */
  onStale: () => void;
  clientName: string;
}) {
  const t = useTranslations('app.appointment.outcome');
  const to = useTranslations('app.outcomes');
  const ts = useTranslations('ui.status');
  const f = useBookingFormat(timezone);
  const toast = useToast();
  const failureText = useFailureText();
  const { refresh } = useSummary();
  const [pending, setPending] = useState<Outcome | null>(null);
  const [failure, setFailure] = useState<OutcomeFailure>();
  const busy = useRef(false);

  const pick = async (outcome: Outcome) => {
    if (busy.current) return;
    busy.current = true;
    setPending(outcome);
    setFailure(undefined);
    try {
      const result = await markOutcome(appt.id, outcome);
      onMarked(result.appointment.status);
      toast.show(to('marked', { name: clientName, outcome: ts(statusKey[outcome]) }));
    } catch (error) {
      const next = outcomeFailure(error);
      setFailure(next);
      toast.show(failureText(next), 'error');
      if (next.kind === 'conflict' || next.kind === 'notStarted') onStale();
    } finally {
      busy.current = false;
      setPending(null);
      refresh();
    }
  };

  const hintId = 'outcome-hint';
  const hint =
    options.window === 'upcoming'
      ? t('upcoming', { time: f.time(appt.startAt) })
      : options.window === 'inProgress'
        ? t('inProgress', { time: f.time(appt.endAt) })
        : options.current === 'LATE_CANCEL'
          ? t('lateCancelFinal')
          : options.current
            ? t('recorded', { outcome: ts(statusKey[options.current]) })
            : t('ended', { name: clientName });
  return (
    <Card as="section" size="sm" padding="compact" aria-labelledby="outcome-title" className="flex flex-col gap-3">
      <h2 id="outcome-title" className="m-0 text-lg font-semibold">
        {t('title')}
      </h2>
      <p id={hintId} className="m-0 text-sm leading-normal text-muted">
        {hint}
      </p>
      <OutcomeButtons
        name={clientName}
        states={options.options}
        pending={pending}
        onPick={pick}
        describedBy={hintId}
      />
      {failure ? (
        <p role="alert" className="m-0 text-sm font-medium text-danger">
          {failureText(failure)}
        </p>
      ) : null}
    </Card>
  );
}

/** Board 4.5: one appointment, with the outcome buttons when they apply and a confirmed cancel. */
export function AppointmentView({ id }: { id: string }) {
  const t = useTranslations('app.appointment');
  const ts = useTranslations('ui.status');
  const tc = useTranslations('app.today.sheet');
  const { timezone } = useAppSession();
  const router = useRouter();
  const f = useBookingFormat(timezone);
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const { refresh } = useSummary();
  const now = useNow();
  const label = useClientLabel();
  const res = useResource((signal) => getAppointment(id, signal), id);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string>();

  const back = () => {
    if (window.history.length > 1) router.back();
    else router.push('/app');
  };
  const backButton = (
    <IconButton label={t('back')} onClick={back} className="self-start">
      <ChevronLeft size={20} aria-hidden="true" className="rtl:-scale-x-100" />
    </IconButton>
  );

  if (res.error && !res.data) {
    if (errorKey(res.error) === 'notFound') {
      return (
        <>
          {backButton}
          <EmptyState
            icon={<CalendarX2 size={22} />}
            title={t('notFoundTitle')}
            body={t('notFoundBody')}
            action={
              <ButtonLink href="/app" variant="secondary">
                {t('backToToday')}
              </ButtonLink>
            }
          />
        </>
      );
    }
    return (
      <>
        {backButton}
        <LoadError error={res.error} onRetry={res.reload} />
      </>
    );
  }
  if (!res.data) {
    return (
      <>
        {backButton}
        <Skeletons />
      </>
    );
  }

  const appt = res.data;
  const options = outcomeOptions(appt, now);
  const tone = apptTone({ status: appt.status, source: appt.source });
  const relation = dayRelation(appt.startAt, timezone, now);
  const eyebrow =
    relation === 'today'
      ? t('eyebrowToday', { day: f.day(appt.startAt) })
      : relation === 'tomorrow'
        ? t('eyebrowTomorrow', { day: f.day(appt.startAt) })
        : f.dayLong(appt.startAt);
  const sourceKey =
    appt.source === 'PUBLIC' ? 'public' : appt.source === 'WAITLIST' ? 'waitlist' : 'frontDesk';
  const confirmed = appt.status === 'CONFIRMED' || Boolean(appt.confirmedAt);
  const statusText =
    confirmed && (appt.status === 'CONFIRMED' || appt.status === 'BOOKED')
      ? t('confirmedByClient')
      : ts(toneLabelKey[tone === 'waitlist' ? 'booked' : tone]);
  const cancellable =
    (appt.status === 'BOOKED' || appt.status === 'CONFIRMED') && now.getTime() < Date.parse(appt.startAt);
  // Only for a booking that can still be reminded, and only once the server sent the field (older cache: hidden).
  const remindable =
    (appt.status === 'BOOKED' || appt.status === 'CONFIRMED') &&
    appt.reminderEmail !== undefined &&
    !isDeletedClient(appt.client.phone);
  const wa = whatsappChatUrl(appt.client.phone);
  const tel = telUrl(appt.client.phone);
  const deleted = isDeletedClient(appt.client.phone);
  const clientName = label(appt.client);
  const counts = `${t('noShowCount', { count: appt.client.noShows })}${
    appt.client.lateCancels ? `, ${t('lateCancelCount', { count: appt.client.lateCancels })}` : ''
  }`;

  // Plain strings, so the JSX below holds no calls with literal arguments.
  const sheet = {
    call: tc('call'),
    whatsapp: tc('whatsapp'),
    callAria: tc('callAria', { name: clientName }),
    whatsappAria: tc('whatsappAria', { name: clientName }),
    confirmTitle: tc('confirmTitle'),
    confirmBody: tc('confirmBody', { name: clientName }),
    close: tc('close'),
    confirmYes: tc('confirmYes'),
    confirmKeep: tc('confirmKeep'),
  };

  const cancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    setCancelError(undefined);
    try {
      await cancelAppointment(appt.id);
      setConfirming(false);
      toast.show(tc('cancelledToast', { name: clientName }));
      res.setData({ ...appt, status: 'CANCELLED' });
      refresh();
      res.reload();
    } catch (error) {
      setCancelError(errorMessage(error));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <>
      {backButton}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-x-5">
        <section
          aria-label={t('detailsLabel')}
          className="bg-hero flex flex-col gap-2.5 rounded-card p-5 text-white md:p-[26px]"
        >
          <span className="text-[13px] font-semibold tracking-[0.06em] text-hero-subtle uppercase">
            {eyebrow}
          </span>
          <span className="text-[34px] leading-none font-semibold tabular-nums md:text-[44px]">
            <TimeRange start={f.time(appt.startAt)} end={f.time(appt.endAt)} />
          </span>
          <span className="text-[17px] text-hero-muted">
            {t('summary', {
              service: isolate(appt.service.name),
              staff: isolate(appt.staff.displayName),
              source: t(`source.${sourceKey}`),
            })}
          </span>
          <span className="inline-flex min-h-8 items-center self-start rounded-chip bg-accent px-3 py-1.5 text-[13px] font-medium text-ink">
            {statusText}
          </span>
        </section>

        {options.open ? (
          <div className="lg:col-start-2 lg:row-span-3 lg:row-start-1">
            <OutcomeCard
              appt={appt}
              options={options}
              timezone={timezone}
              clientName={clientName}
              onStale={res.reload}
              onMarked={(status) => {
                res.setData({ ...appt, status });
                res.reload();
              }}
            />
          </div>
        ) : null}

        <Card
          as="section"
          size="sm"
          padding="compact"
          aria-label={t('clientLabel')}
          className="flex flex-wrap items-center gap-3.5 lg:col-start-1"
        >
          <span
            aria-hidden="true"
            className="flex size-[52px] shrink-0 items-center justify-center rounded-pill bg-brand-avatar text-lg font-semibold text-brand"
          >
            {initials(clientName)}
          </span>
          <ClientHead
            // An anonymised client has no history page (it would 404).
            href={deleted ? null : `/app/clients/${appt.client.id}`}
            ariaLabel={t('clientHistoryAria', { name: clientName })}
          >
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-semibold">
              {clientName}
              {appt.client.repeatNoShow && !deleted ? <NoShowBadge count={appt.client.noShows} /> : null}
            </span>
            <span className="text-sm text-muted">
              <MetaLine
                items={[<Bidi key="p" dir="ltr">{formatPhone(appt.client.phone)}</Bidi>, deleted ? null : counts]}
              />
            </span>
          </ClientHead>
          <div className="flex w-full gap-2 sm:w-auto">
            {tel ? (
              <ButtonLink
                href={tel}
                variant="secondary"
                size="row"
                aria-label={sheet.callAria}
                className="flex-1 sm:flex-none"
              >
                <Phone size={18} aria-hidden="true" />
                {sheet.call}
              </ButtonLink>
            ) : null}
            {wa ? (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={sheet.whatsappAria}
                className={buttonClasses({ variant: 'secondary', size: 'row', className: 'flex-1 sm:flex-none' })}
              >
                <MessageCircle size={18} aria-hidden="true" />
                {sheet.whatsapp}
              </a>
            ) : null}
          </div>
          {remindable ? (
            <p
              data-testid="reminders-go-to"
              className="m-0 flex w-full flex-col gap-0.5 border-t border-line pt-3 text-sm leading-normal text-muted"
            >
              {appt.reminderEmail ? (
                <>
                  <span>
                    {t('reminders.goTo')}{' '}
                    <Bidi dir="ltr" className="font-medium break-all text-ink">
                      {appt.reminderEmail}
                    </Bidi>
                  </span>
                  {appt.reminderEmailDiffers ? (
                    <span className="text-[13px]">{t('reminders.differs')}</span>
                  ) : null}
                </>
              ) : (
                <span>{t('reminders.none')}</span>
              )}
            </p>
          ) : null}
        </Card>

        {cancellable ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 lg:col-start-1">
            <Button variant="danger" size="row" onClick={() => setConfirming(true)}>
              {t('cancel')}
            </Button>
            <span className="text-sm text-muted">{t('cancelNote')}</span>
          </div>
        ) : null}
      </div>

      <Sheet
        open={confirming}
        onOpenChange={(open) => {
          if (!open) {
            setConfirming(false);
            setCancelError(undefined);
          }
        }}
        title={sheet.confirmTitle}
        description={sheet.confirmBody}
        closeLabel={sheet.close}
      >
        <div className="flex flex-col gap-3">
          {cancelError ? (
            <p role="alert" className="m-0 text-sm text-danger">
              {cancelError}
            </p>
          ) : null}
          <Button variant="danger" size="lg" block loading={cancelling} onClick={cancel}>
            {sheet.confirmYes}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            block
            disabled={cancelling}
            onClick={() => setConfirming(false)}
          >
            {sheet.confirmKeep}
          </Button>
        </div>
      </Sheet>
    </>
  );
}
