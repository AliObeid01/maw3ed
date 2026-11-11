'use client';

import { CalendarClock, CalendarDays } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DayNav, WeekStrip } from '@/components/app/DayNav';
import { HeaderActions } from '@/components/app/HeaderActions';
import { useAppSession } from '@/components/app/SessionContext';
import { EmptyState, LoadError } from '@/components/app/states';
import { useSummary } from '@/components/app/SummaryContext';
import { useViewedDay } from '@/components/app/ViewedDayContext';
import { usePolling } from '@/components/app/usePolling';
import { useBookingFormat } from '@/components/booking/useBookingFormat';
import { BarberAppointmentSheet } from '@/components/appointments/BarberAppointment';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatTile } from '@/components/ui/StatTile';
import { getToday, type TodayAppointment } from '@/lib/api/dashboard';
import { useResource } from '@/lib/api/useResource';
import { isActive, todayIn } from '@/lib/dashboard/agenda';
import { normalizeDay, shiftDayClamped } from '@/lib/dashboard/dayPicker';
import { errorKey } from '@/lib/setup/errors';
import { useIsDesktop } from '@/lib/useMediaQuery';
import { Agenda } from './Agenda';
import { CalendarGrid } from './CalendarGrid';
import { NeedsYou } from './SideCards';

function BarberSkeleton() {
  const label = useTranslations('app.today')('loading');
  return (
    <div className="flex flex-col gap-[18px]" aria-busy="true" aria-label={label} role="status">
      <Skeleton className="h-[84px] rounded-tile" />
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[72px] rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

/**
 * The barber's Today (PRACTITIONER): the same day strip and agenda as the owner's, fed by the scoped endpoint, so
 * it only holds their own appointments. One stat, the outcomes-to-mark card, no waitlist, no reminders, no booking.
 */
export function BarberTodayView() {
  const t = useTranslations('app.today');
  const tp = useTranslations('app.practitioner');
  const { timezone } = useAppSession();
  const f = useBookingFormat(timezone);
  const { refresh: refreshSummary } = useSummary();
  const desktop = useIsDesktop();
  // The viewed day lives in the app frame (PR-3) so the header follows it; leaving the screen clears it.
  const { viewedDay, setViewedDay, now } = useViewedDay();
  const today = todayIn(timezone, now);
  const day = viewedDay ?? today;
  const setDay = (next: string) => setViewedDay(normalizeDay(next, today));
  useEffect(() => () => setViewedDay(null), [setViewedDay]);
  const [open, setOpen] = useState<TodayAppointment | null>(null);

  const res = useResource((signal) => getToday(day, signal), day);
  usePolling(res.reload);
  const data = res.data;
  const isToday = day === today;
  const visibleCount = data ? data.appointments.filter(isActive).length : 0;

  // Plain strings, so the JSX below holds no calls with literal arguments.
  const text = {
    noScheduleTitle: tp('noScheduleTitle'),
    noScheduleBody: tp('noScheduleBody'),
    emptyTitle: isToday ? tp('empty.titleToday') : tp('empty.title'),
    emptyBody: tp('empty.body'),
  };

  // A login that is not linked to an active team member is refused with 403 and gets this calm state.
  if (res.error && !data && errorKey(res.error) === 'forbidden')
    return (
      <EmptyState
        icon={<CalendarClock size={22} />}
        title={text.noScheduleTitle}
        body={text.noScheduleBody}
      />
    );

  return (
    <>
      <HeaderActions>
        <DayNav
          day={day}
          today={today}
          onPick={setDay}
          onShift={(delta) => setDay(shiftDayClamped(day, delta))}
          onToday={() => setViewedDay(null)}
        />
      </HeaderActions>
      <WeekStrip day={day} today={today} onPick={setDay} />

      {res.error && !data ? (
        <LoadError error={res.error} onRetry={res.reload} />
      ) : !data ? (
        <BarberSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile
              value={data.stats.appointments}
              label={isToday ? t('stats.appointmentsToday') : t('stats.appointments')}
            />
          </div>
          <NeedsYou count={data.outcomesToMark} />
          <section aria-labelledby="day-heading" className="flex min-w-0 flex-col gap-3.5">
            <h2 id="day-heading" className="m-0 text-xl font-semibold">
              {f.dayLong(`${day}T12:00:00Z`)}
            </h2>
            {visibleCount === 0 ? (
              <EmptyState
                icon={<CalendarDays size={22} />}
                title={text.emptyTitle}
                body={text.emptyBody}
              />
            ) : desktop ? (
              <CalendarGrid
                appointments={data.appointments}
                staff={data.staff}
                timezone={timezone}
                onOpen={setOpen}
              />
            ) : (
              <Agenda
                appointments={data.appointments}
                timezone={timezone}
                staffId={undefined}
                onOpen={setOpen}
              />
            )}
          </section>
        </>
      )}

      <BarberAppointmentSheet
        appointment={open}
        timezone={timezone}
        onClose={() => setOpen(null)}
        onChanged={(status) => {
          if (status) setOpen((current) => (current ? { ...current, status } : current));
          res.reload();
          refreshSummary();
        }}
      />
    </>
  );
}
