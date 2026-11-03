'use client';

import { ChevronRight, MessageCircle } from 'lucide-react';
import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { useBookingFormat } from '@/components/booking/useBookingFormat';
import { NoShowBadge } from '@/components/app/NoShowBadge';
import { Bidi, MetaLine } from '@/components/ui/Bidi';
import { Chip } from '@/components/ui/Chip';
import type { TodayAppointment } from '@/lib/api/dashboard';
import { apptTone, groupAgenda } from '@/lib/dashboard/agenda';
import { clockOf } from '@/lib/time/clock';
import { cn } from '@/lib/cn';
import { chipTone, toneLabelKey } from './apptStyles';

/** "All" plus one chip per active bookable person; a group of toggle buttons (a filter, not navigation). */
export function StaffFilter({
  staff,
  value,
  onChange,
}: {
  staff: { id: string; displayName: string }[];
  value: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const t = useTranslations('app.today');
  const labelId = useId();
  if (staff.length < 2) return null;
  const chip = (active: boolean) =>
    cn(
      'inline-flex h-11 shrink-0 items-center rounded-btn border px-4 text-[15px] transition-colors duration-200 ease-out',
      active
        ? 'border-brand bg-brand font-semibold text-white'
        : 'border-line bg-surface text-ink hover:border-brand',
    );
  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="sr-only">
        {t('staffFilter')}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        data-allow-overflow
        className="-mx-4 flex gap-2 overflow-x-auto ps-4 pe-20 pb-1 md:mx-0 md:flex-wrap md:px-0"
      >
        <button type="button" aria-pressed={value === undefined} className={chip(value === undefined)} onClick={() => onChange(undefined)}>
          {t('all')}
        </button>
        {staff.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={value === s.id}
            className={chip(value === s.id)}
            onClick={() => onChange(s.id)}
          >
            {s.displayName}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Phone agenda: appointments grouped by hour; each row opens the appointment sheet. */
export function Agenda({
  appointments,
  timezone,
  staffId,
  onOpen,
}: {
  appointments: TodayAppointment[];
  timezone: string;
  staffId: string | undefined;
  onOpen: (appt: TodayAppointment) => void;
}) {
  const t = useTranslations('app.today');
  const ts = useTranslations('ui.status');
  const f = useBookingFormat(timezone);
  const groups = groupAgenda(appointments, timezone, staffId);
  const baseId = useId();

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => {
        const headingId = `${baseId}-${group.key}`;
        return (
          <section key={group.key} aria-labelledby={headingId} className="flex flex-col gap-2">
            <h3
              id={headingId}
              className="m-0 text-[13px] font-semibold tracking-[0.08em] text-muted uppercase tabular-nums"
            >
              <bdi dir="ltr">{clockOf(group.hour)}</bdi>
            </h3>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {group.items.map((appt) => {
                const tone = apptTone(appt);
                return (
                  <li key={appt.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(appt)}
                      className="flex min-h-[72px] w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3.5 text-start transition-colors duration-200 ease-out hover:border-brand"
                    >
                      <span className="flex w-[52px] shrink-0 flex-col text-[15px] font-semibold tabular-nums">
                        <bdi dir="ltr">{f.time(appt.startAt)}</bdi>
                        <span className="text-xs font-normal text-muted">
                          <bdi dir="ltr">{f.time(appt.endAt)}</bdi>
                        </span>
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="truncate text-base font-semibold">{appt.client.name}</span>
                          {appt.client.repeatNoShow ? (
                            <NoShowBadge count={appt.client.noShows} />
                          ) : null}
                        </span>
                        <span className="truncate text-sm text-muted">
                          <MetaLine
                            items={[
                              <Bidi key="s">{appt.service.name}</Bidi>,
                              <Bidi key="p">{appt.staff.displayName}</Bidi>,
                            ]}
                          />
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1.5">
                        <Chip tone={chipTone[tone]}>{ts(toneLabelKey[tone])}</Chip>
                        {appt.reminders.whatsappPending ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted">
                            <MessageCircle size={14} aria-hidden="true" />
                            <span className="sr-only">{t('reminderPending')}</span>
                          </span>
                        ) : null}
                      </span>
                      <ChevronRight
                        size={18}
                        aria-hidden="true"
                        className="shrink-0 text-subtle rtl:-scale-x-100"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
