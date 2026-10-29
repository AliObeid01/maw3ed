'use client';

import { useTranslations } from 'next-intl';
import { NoShowBadge } from '@/components/app/NoShowBadge';
import { useBookingFormat } from '@/components/booking/useBookingFormat';
import type { TodayAppointment } from '@/lib/api/dashboard';
import { apptTone, isActive } from '@/lib/dashboard/agenda';
import { blockBox, calendarRange, hourMarks, ROW_PX } from '@/lib/dashboard/calendar';
import { initials } from '@/lib/dashboard/phone';
import { cn } from '@/lib/cn';
import { blockTint, toneLabelKey } from './apptStyles';

const avatarTints = [
  'bg-brand-avatar text-brand',
  'bg-success-soft text-success',
  'bg-amber-soft text-amber',
];

/** Board 22 calendar for `lg+`: 64 px time column, one column per person, 44 px per 30 minutes. */
export function CalendarGrid({
  appointments,
  staff,
  timezone,
  onOpen,
}: {
  appointments: TodayAppointment[];
  staff: { id: string; displayName: string }[];
  timezone: string;
  onOpen: (appt: TodayAppointment) => void;
}) {
  const t = useTranslations('app.today');
  const ts = useTranslations('ui.status');
  const f = useBookingFormat(timezone);
  const range = calendarRange(appointments, timezone);
  const marks = hourMarks(range);
  const height = marks.length * 2 * ROW_PX;
  const lines =
    'repeating-linear-gradient(to bottom, transparent 0, transparent 43px, var(--color-row) 43px, var(--color-row) 44px)';
  const active = appointments.filter(isActive);

  return (
    <div
      role="group"
      aria-label={t('calendarLabel')}
      className="overflow-x-auto rounded-card border border-line bg-surface"
    >
      <div
        className="grid min-w-[600px] gap-x-2 px-3.5 pb-3.5"
        style={{ gridTemplateColumns: `64px repeat(${Math.max(staff.length, 1)}, minmax(160px, 1fr))` }}
      >
        <span className="h-12" aria-hidden="true" />
        {staff.map((s, i) => (
          <div key={s.id} className="flex h-12 items-center gap-2 text-[15px] font-semibold">
            <span
              aria-hidden="true"
              className={cn(
                'flex size-7 items-center justify-center rounded-pill text-[13px]',
                avatarTints[i % avatarTints.length],
              )}
            >
              {initials(s.displayName).charAt(0)}
            </span>
            {s.displayName}
          </div>
        ))}
        <div className="relative" style={{ height }} aria-hidden="true">
          {marks.map((hour, i) => (
            <span
              key={hour}
              className="absolute text-xs text-muted tabular-nums"
              style={{ top: i * 2 * ROW_PX + 4 }}
            >
              <bdi dir="ltr">{`${hour}:00`}</bdi>
            </span>
          ))}
        </div>
        {staff.map((s) => (
          <div
            key={s.id}
            role="list"
            aria-label={s.displayName}
            className="relative"
            style={{ height, backgroundImage: lines }}
          >
            {active
              .filter((a) => a.staff.id === s.id)
              .map((appt) => {
                const box = blockBox(appt, timezone, range.startHour);
                const tone = apptTone(appt);
                return (
                  <div
                    key={appt.id}
                    role="listitem"
                    className="absolute inset-x-0 py-[2px]"
                    style={{ top: box.top, height: box.height }}
                  >
                    <button
                      type="button"
                      onClick={() => onOpen(appt)}
                      className={cn(
                        'flex size-full overflow-hidden text-start transition-[filter] duration-200 ease-out hover:brightness-95',
                        blockTint[tone],
                        box.compact
                          ? 'items-center gap-1.5 rounded-[10px] px-2.5'
                          : 'flex-col gap-0.5 rounded-xl px-2.5 py-2',
                      )}
                    >
                      <span className="truncate text-[13px] font-semibold">{appt.client.name}</span>
                      <span className="truncate text-xs">
                        <bdi dir="ltr">{f.time(appt.startAt)}</bdi> · {appt.service.name}
                        {box.compact ? null : <> · {ts(toneLabelKey[tone])}</>}
                      </span>
                      {appt.client.repeatNoShow && !box.compact ? (
                        <NoShowBadge count={appt.client.noShows} className="self-start" />
                      ) : null}
                    </button>
                  </div>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}
