'use client';

import { CalendarX2, ChevronLeft, MessageCircle, Phone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useAppSession } from '@/components/app/SessionContext';
import { EmptyState, LoadError } from '@/components/app/states';
import { useClientLabel } from '@/components/app/useClientLabel';
import { useBookingFormat } from '@/components/booking/useBookingFormat';
import { toneLabelKey, chipTone } from '@/components/dashboard/apptStyles';
import { Bidi } from '@/components/ui/Bidi';
import { buttonClasses, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { getAppointment } from '@/lib/api/outcomes';
import { useResource } from '@/lib/api/useResource';
import { PRACTITIONER_HOME } from '@/lib/auth/practitionerPaths';
import { apptTone } from '@/lib/dashboard/agenda';
import { formatPhone, telUrl, whatsappChatUrl } from '@/lib/dashboard/phone';
import { outcomeOptions } from '@/lib/outcomes/eligibility';
import { errorKey } from '@/lib/setup/errors';
import { OutcomeCard, useNow } from './AppointmentView';

/** What the barber sees of one of their own appointments: first name and phone, never an e-mail or a history. */
export type BarberAppt = {
  id: string;
  status: string;
  startAt: string;
  endAt: string;
  confirmedAt?: string | null | undefined;
  client: { name: string; phone: string };
  service: { name: string };
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-row py-3 last:border-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="m-0 text-end text-[15px] font-medium">{children}</dd>
    </div>
  );
}

/**
 * One appointment of the barber: who and when, Call and WhatsApp (the client's phone, for their own appointments
 * only), the status and the outcome buttons with the same rules and hints as the owner's view. No cancel, no edit,
 * no excuse and no booking.
 */
export function BarberAppointmentBody({
  appt,
  timezone,
  onChanged,
}: {
  appt: BarberAppt;
  timezone: string;
  /** The server accepted an outcome (or disagreed): the parent refreshes its copy of the appointment. */
  onChanged: (status?: string) => void;
}) {
  const t = useTranslations('app.today.sheet');
  const ts = useTranslations('ui.status');
  const f = useBookingFormat(timezone);
  const label = useClientLabel();
  const now = useNow();
  const name = label(appt.client);
  const tone = apptTone({ status: appt.status, source: 'PUBLIC' });
  const options = outcomeOptions(appt, now);
  const tel = telUrl(appt.client.phone);
  const wa = whatsappChatUrl(appt.client.phone);
  const confirmed = Boolean(appt.confirmedAt);
  // Plain strings, so the JSX below holds no calls with literal arguments.
  const text = {
    call: t('call'),
    whatsapp: t('whatsapp'),
    callAria: t('callAria', { name }),
    whatsappAria: t('whatsappAria', { name }),
  };

  return (
    <div className="flex flex-col gap-4">
      <span className="text-xl font-semibold">{name}</span>
      <dl className="m-0 flex flex-col">
        <Row label={t('status')}>
          <Chip tone={chipTone[tone]}>{ts(toneLabelKey[tone])}</Chip>
        </Row>
        <Row label={t('when')}>
          {f.dayLong(appt.startAt)},{' '}
          <bdi dir="ltr" className="tabular-nums">
            {f.time(appt.startAt)}–{f.time(appt.endAt)}
          </bdi>
        </Row>
        <Row label={t('service')}>
          <Bidi>{appt.service.name}</Bidi>
        </Row>
        <Row label={t('phone')}>
          <bdi dir="ltr">{formatPhone(appt.client.phone)}</bdi>
        </Row>
        {confirmed ? <Row label={t('confirmation')}>{t('confirmedByClient')}</Row> : null}
      </dl>
      <div className="grid grid-cols-2 gap-2 empty:hidden">
        {tel ? (
          <ButtonLink href={tel} variant="call" size="row" aria-label={text.callAria}>
            <Phone size={18} aria-hidden="true" />
            {text.call}
          </ButtonLink>
        ) : null}
        {wa ? (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={text.whatsappAria}
            className={buttonClasses({ variant: 'whatsapp', size: 'row' })}
          >
            <MessageCircle size={18} aria-hidden="true" />
            {text.whatsapp}
          </a>
        ) : null}
      </div>
      {options.open ? (
        <OutcomeCard
          appt={appt}
          options={options}
          timezone={timezone}
          clientName={name}
          canExcuse={false}
          onStale={() => onChanged()}
          onMarked={(status) => onChanged(status)}
        />
      ) : null}
    </div>
  );
}

/** The sheet opened from the barber's Today agenda. */
export function BarberAppointmentSheet({
  appointment,
  timezone,
  onClose,
  onChanged,
}: {
  appointment: BarberAppt | null;
  timezone: string;
  onClose: () => void;
  onChanged: (status?: string) => void;
}) {
  const t = useTranslations('app.today.sheet');
  return (
    <Sheet
      open={appointment !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t('title')}
      closeLabel={t('close')}
    >
      {appointment ? (
        <BarberAppointmentBody appt={appointment} timezone={timezone} onChanged={onChanged} />
      ) : null}
    </Sheet>
  );
}

/** `/app/appointments/[id]` for the barber (reached from the outcome queue). Another barber's id is a 404 page. */
export function BarberAppointmentView({ id }: { id: string }) {
  const t = useTranslations('app.appointment');
  const { timezone } = useAppSession();
  const router = useRouter();
  const res = useResource((signal) => getAppointment(id, signal), id);
  const back = () => {
    if (window.history.length > 1) router.back();
    else router.push(PRACTITIONER_HOME);
  };
  const backButton = (
    <IconButton label={t('back')} onClick={back} className="self-start">
      <ChevronLeft size={20} aria-hidden="true" className="rtl:-scale-x-100" />
    </IconButton>
  );

  if (res.error && !res.data) {
    return (
      <>
        {backButton}
        {errorKey(res.error) === 'notFound' ? (
          <EmptyState
            icon={<CalendarX2 size={22} />}
            title={t('notFoundTitle')}
            body={t('notFoundBody')}
            action={
              <ButtonLink href={PRACTITIONER_HOME} variant="secondary">
                {t('backToToday')}
              </ButtonLink>
            }
          />
        ) : (
          <LoadError error={res.error} onRetry={res.reload} />
        )}
      </>
    );
  }
  if (!res.data) {
    return (
      <>
        {backButton}
        <div role="status" aria-busy="true" aria-label={t('loading')}>
          <Skeleton className="h-[320px] rounded-card" />
        </div>
      </>
    );
  }
  const appt = res.data;
  return (
    <>
      {backButton}
      <Card as="section" aria-label={t('detailsLabel')} className="max-w-xl">
        <BarberAppointmentBody
          appt={appt}
          timezone={timezone}
          onChanged={(status) => {
            if (status) res.setData({ ...appt, status });
            res.reload();
          }}
        />
      </Card>
    </>
  );
}
