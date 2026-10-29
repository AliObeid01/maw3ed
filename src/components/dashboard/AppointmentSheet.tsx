'use client';

import { MessageCircle, Phone } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { NoShowBadge } from '@/components/app/NoShowBadge';
import { useErrorMessage } from '@/components/app/states';
import { useBookingFormat } from '@/components/booking/useBookingFormat';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Sheet } from '@/components/ui/Sheet';
import { cancelAppointment, type TodayAppointment } from '@/lib/api/dashboard';
import { apptTone } from '@/lib/dashboard/agenda';
import { formatPhone, whatsappChatUrl } from '@/lib/dashboard/phone';
import { chipTone, toneLabelKey } from './apptStyles';

const CANCELLABLE = new Set(['BOOKED', 'CONFIRMED']);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-row py-3 last:border-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="m-0 text-end text-[15px] font-medium">{children}</dd>
    </div>
  );
}

/** Details of one appointment with phone / WhatsApp shortcuts and a confirmed cancel. */
export function AppointmentSheet({
  appointment,
  timezone,
  onClose,
  onCancelled,
}: {
  appointment: TodayAppointment | null;
  timezone: string;
  onClose: () => void;
  /** Called after the server cancelled it, so the day can reload. */
  onCancelled: (message: string) => void;
}) {
  const t = useTranslations('app.today.sheet');
  const ts = useTranslations('ui.status');
  const f = useBookingFormat(timezone);
  const errorMessage = useErrorMessage();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const appt = appointment;
  const close = () => {
    setConfirming(false);
    setError(undefined);
    onClose();
  };

  const cancel = async () => {
    if (!appt || pending) return;
    setPending(true);
    setError(undefined);
    try {
      await cancelAppointment(appt.id);
      setConfirming(false);
      onCancelled(t('cancelledToast', { name: appt.client.name }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  const tone = appt ? apptTone(appt) : 'booked';
  const wa = appt ? whatsappChatUrl(appt.client.phone) : null;

  return (
    <>
      <Sheet
        open={appt !== null && !confirming}
        onOpenChange={(open) => !open && close()}
        title={t('title')}
        closeLabel={t('close')}
      >
        {appt ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xl font-semibold">{appt.client.name}</span>
              {appt.client.repeatNoShow ? <NoShowBadge count={appt.client.noShows} /> : null}
            </div>
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
              <Row label={t('service')}>{appt.service.name}</Row>
              <Row label={t('staff')}>{appt.staff.displayName}</Row>
              <Row label={t('phone')}>
                <bdi dir="ltr">{formatPhone(appt.client.phone)}</bdi>
              </Row>
              {appt.confirmedAt ? <Row label={t('confirmation')}>{t('confirmedByClient')}</Row> : null}
            </dl>
            <div className="grid grid-cols-2 gap-2">
              <ButtonLink
                href={`tel:${appt.client.phone}`}
                variant="secondary"
                size="row"
                aria-label={t('callAria', { name: appt.client.name })}
              >
                <Phone size={18} aria-hidden="true" />
                {t('call')}
              </ButtonLink>
              {wa ? (
                <a
                  href={wa}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('whatsappAria', { name: appt.client.name })}
                  className="inline-flex h-[46px] items-center justify-center gap-2 rounded-pill border border-line bg-surface px-5 text-[15px] font-semibold text-ink no-underline transition-colors duration-200 ease-out hover:bg-canvas"
                >
                  <MessageCircle size={18} aria-hidden="true" />
                  {t('whatsapp')}
                </a>
              ) : null}
            </div>
            {CANCELLABLE.has(appt.status) ? (
              <Button variant="danger" size="row" block onClick={() => setConfirming(true)}>
                {t('cancel')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </Sheet>

      <Sheet
        open={appt !== null && confirming}
        onOpenChange={(open) => {
          if (!open) {
            setConfirming(false);
            setError(undefined);
          }
        }}
        title={t('confirmTitle')}
        description={appt ? t('confirmBody', { name: appt.client.name }) : undefined}
        closeLabel={t('close')}
      >
        <div className="flex flex-col gap-3">
          {error ? (
            <p role="alert" className="m-0 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <Button variant="danger" size="lg" block loading={pending} onClick={cancel}>
            {t('confirmYes')}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            block
            disabled={pending}
            onClick={() => setConfirming(false)}
          >
            {t('confirmKeep')}
          </Button>
        </div>
      </Sheet>
    </>
  );
}
