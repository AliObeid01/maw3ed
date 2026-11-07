'use client';

import { Check, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { BookingSummary } from '@/components/public/BookingSummary';
import { Button, ButtonLink } from '@/components/ui/Button';
import { ltr } from '@/components/ui/Bidi';
import { Card } from '@/components/ui/Card';
import type { BookingResult } from '@/lib/api/booking';
import { reminderPromiseKind } from '@/lib/reminders/promise';
import { useBookingFormat } from './useBookingFormat';

/** Board 1.5: confirmation, what happens next, the manage link and the booking details. */
export function BookedView({
  result,
  clientName,
  hasEmail,
  timezone,
  onAnother,
}: {
  result: BookingResult;
  clientName: string;
  hasEmail: boolean;
  timezone: string;
  onAnother: () => void;
}) {
  const t = useTranslations('booking.booked');
  const tr = useTranslations('reminderPromise');
  const ts = useTranslations('booking.summary');
  const f = useBookingFormat(timezone);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  const { appointment, links } = result;
  const when = `${f.day(appointment.startAt)} · ${f.time(appointment.startAt)}`;

  // Which reminders exist is the server's word (result.reminders); the page never works the windows out.
  const next = [
    {
      id: 'one',
      title: tr('title'),
      body: tr('promise', { kind: reminderPromiseKind(result.reminders) }),
    },
    // Confirm / cancel links ride on reminders, so a booking without any points to its own link instead.
    {
      id: 'three',
      title: t('next3Title'),
      body: t(result.reminders.h24 || result.reminders.h2 ? 'next3Body' : 'next3BodyNoReminder'),
    },
  ];

  const rows = [
    {
      id: 'service',
      label: ts('service'),
      value: ts('serviceValue', {
        name: appointment.service.name,
        duration: f.duration(appointment.service.durationMin),
      }),
    },
    { id: 'with', label: ts('with'), value: appointment.staff.displayName },
    { id: 'when', label: ts('when'), value: when },
    { id: 'price', label: ts('price'), value: f.money(appointment.service.price) },
    ...(appointment.reference
      ? [{ id: 'reference', label: ts('reference'), value: ltr(appointment.reference) }]
      : []),
  ];

  return (
    <>
      <section className="flex min-w-0 flex-[999_1_320px] flex-col gap-4.5">
        <Card className="flex flex-col gap-5 md:gap-6">
          <div className="flex items-start gap-4">
            <span
              aria-hidden="true"
              className="flex size-14 shrink-0 items-center justify-center rounded-pill bg-success-soft text-success"
            >
              <Check size={30} strokeWidth={3} />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="m-0 text-2xl leading-tight font-semibold outline-none md:text-[28px]"
              >
                {t('title', { name: clientName.trim().split(/\s+/)[0] ?? clientName })}
              </h2>
              <p className="m-0 text-[15px] text-muted">
                {t('subtitle', {
                  when: `${when} – ${f.time(appointment.endAt)}`,
                  service: appointment.service.name,
                  staff: appointment.staff.displayName,
                })}
              </p>
            </div>
          </div>
          {hasEmail ? (
            <p className="m-0 rounded-card-sm bg-brand-soft p-4 text-sm text-brand-deep">
              {t('calendar')}
            </p>
          ) : null}
        </Card>

        <Card className="flex flex-col gap-4">
          <h3 className="m-0 text-lg font-semibold">{t('nextTitle')}</h3>
          <ol className="m-0 flex list-none flex-col gap-4 p-0">
            {next.map((item, i) => (
              <li key={item.id} className="flex items-start gap-3.5">
                <span
                  aria-hidden="true"
                  className="flex size-[30px] shrink-0 items-center justify-center rounded-pill bg-brand-soft text-sm font-semibold text-brand"
                >
                  {i + 1}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[15px] font-semibold">{item.title}</span>
                  <span className="text-sm text-muted">{item.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>

        <div className="flex flex-col gap-2">
          <ButtonLink
            href={links.manage}
            variant="secondary"
            size="lg"
            className="max-sm:w-full sm:self-start"
          >
            {t('manage')}
            <ExternalLink size={16} aria-hidden="true" className="rtl:-scale-x-100" />
          </ButtonLink>
          <p className="m-0 text-[13px] text-muted">{t('manageHint')}</p>
        </div>
      </section>

      <aside className="flex w-full max-w-none flex-[1_1_240px] flex-col gap-3.5 lg:max-w-[290px]">
        <Card size="sm" padding="compact" className="flex flex-col gap-3.5">
          <h2 className="m-0 text-base font-semibold">{t('detailsTitle')}</h2>
          <BookingSummary rows={rows} bare />
        </Card>
        <Button variant="secondary" size="lg" block onClick={onAnother}>
          {t('another')}
        </Button>
      </aside>
    </>
  );
}
