'use client';

import { useTranslations } from 'next-intl';
import { NoShowBadge } from '@/components/app/NoShowBadge';
import { timeRangeText } from '@/components/ui/Bidi';
import { useBookingFormat } from '@/components/booking/useBookingFormat';
import type { TodayAppointment } from '@/lib/api/dashboard';
import { apptTone, isActive } from '@/lib/dashboard/agenda';
import { calendarRange, hourMarks, layoutColumn, ROW_PX } from '@/lib/dashboard/calendar';
import { initials } from '@/lib/dashboard/phone';
import { clockOf } from '@/lib/time/clock';
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
  const ts = useTranslations('ui.status');
  const t = useTranslations('app');
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
      aria-label={t('today.calendarLabel')}
      data-allow-overflow
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
              <bdi dir="ltr">{clockOf(hour)}</bdi>
            </span>
          ))}
        </div>
        {staff.map((s) => {
          const blocks = layoutColumn(
            active.filter((a) => a.staff.id === s.id),
            timezone,
            range.startHour,
          );
          // A short block at the very end of the day is drawn at its minimum height: let the column grow to hold it.
          const columnHeight = Math.max(height, ...blocks.map((b) => b.top + b.height));
          return (
            <div
              key={s.id}
              role="list"
              aria-label={s.displayName}
              className="relative"
              style={{ height: columnHeight, backgroundImage: lines }}
            >
              {blocks.map(({ item: appt, top, height: blockHeight, compact, lane, lanes }) => {
                const tone = apptTone(appt);
                const start = f.time(appt.startAt);
                const end = f.time(appt.endAt);
                const status = ts(toneLabelKey[tone]);
                const noShowLabel = t('dashboard.noShows', { count: appt.client.noShows });
                const noShowText = appt.client.repeatNoShow ? noShowLabel : null;
                const details = [
                  appt.client.name,
                  timeRangeText(start, end),
                  appt.service.name,
                  appt.staff.displayName,
                  status,
                  noShowText,
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <div
                    key={appt.id}
                    role="listitem"
                    className="absolute py-[2px] focus-within:z-10"
                    style={{
                      top,
                      height: blockHeight,
                      width: `${100 / lanes}%`,
                      insetInlineStart: `${(lane / lanes) * 100}%`,
                    }}
                  >
                    <button
                      type="button"
                      title={details}
                      // `title` is not an accessible name: the full details (client, time, service, staff, status) are.
                      aria-label={details}
                      onClick={() => onOpen(appt)}
                      className={cn(
                        'flex size-full overflow-hidden text-start transition-[filter] duration-200 ease-out hover:brightness-95 focus-visible:outline-offset-[-2px]',
                        blockTint[tone],
                        compact
                          ? 'items-center gap-1.5 rounded-[10px] px-2.5'
                          : cn(
                              'flex-col rounded-xl px-2.5',
                              blockHeight < 60 ? 'justify-center gap-0 py-0.5 leading-4' : 'gap-0.5 py-2',
                            ),
                      )}
                    >
                      {compact ? (
                        <>
                          {appt.client.repeatNoShow ? (
                            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-pill bg-danger" />
                          ) : null}
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{appt.client.name}</span>
                          <span className="shrink-0 text-xs tabular-nums">
                            <bdi dir="ltr">{start}</bdi>
                          </span>
                          {/* What the one-line block cannot show is still in the accessible name. */}
                          <span className="sr-only">
                            {appt.service.name} · {status}
                            {noShowText ? <> · {noShowText}</> : null}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="min-w-0 truncate text-[13px] font-semibold">{appt.client.name}</span>
                            {appt.client.repeatNoShow && blockHeight < 60 ? (
                              <NoShowBadge count={appt.client.noShows} className="ms-auto shrink-0" />
                            ) : null}
                          </span>
                          <span className="truncate text-xs">
                            <bdi dir="ltr">{start}</bdi> · {appt.service.name}
                            {blockHeight < 60 ? null : <> · {status}</>}
                          </span>
                          {appt.client.repeatNoShow && blockHeight >= 60 ? (
                            <NoShowBadge count={appt.client.noShows} className="self-start" />
                          ) : null}
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
