'use client';

import { CalendarDays, Plus } from 'lucide-react';
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
import { ButtonLink } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatTile } from '@/components/ui/StatTile';
import { useToast } from '@/components/ui/Toast';
import { getToday, type TodayAppointment } from '@/lib/api/dashboard';
import { useResource } from '@/lib/api/useResource';
import { isActive, todayIn } from '@/lib/dashboard/agenda';
import { normalizeDay, shiftDayClamped } from '@/lib/dashboard/dayPicker';
import { useIsDesktop } from '@/lib/useMediaQuery';
import { Agenda, StaffFilter } from './Agenda';
import { AppointmentSheet } from './AppointmentSheet';
import { CalendarGrid } from './CalendarGrid';
import { DoThisFirst, NeedsYou, WaitlistActivityCard } from './SideCards';

function TodaySkeleton() {
  const label = useTranslations('app.today')('loading');
  return (
    <div className="flex flex-col gap-[18px]" aria-busy="true" aria-label={label} role="status">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[84px] rounded-tile" />
        ))}
      </div>
      <Skeleton className="h-28 rounded-card" />
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[72px] rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

/** Board 4.1: stats, the day (agenda on phones, calendar at `lg+`) and the side cards. */
export function TodayView() {
  const t = useTranslations('app.today');
  const { timezone } = useAppSession();
  const f = useBookingFormat(timezone);
  const toast = useToast();
  const { refresh: refreshSummary } = useSummary();
  const desktop = useIsDesktop();
  // The viewed day lives in the app frame so the header can follow it; null means "the real today", which moves on
  // by itself past midnight. Leaving the screen clears it, so coming back starts on today.
  const { viewedDay, setViewedDay, now } = useViewedDay();
  const today = todayIn(timezone, now);
  const day = viewedDay ?? today;
  const setDay = (next: string) => setViewedDay(normalizeDay(next, today));
  useEffect(() => () => setViewedDay(null), [setViewedDay]);
  const [staffId, setStaffId] = useState<string>();
  const [open, setOpen] = useState<TodayAppointment | null>(null);

  const res = useResource((signal) => getToday(day, signal), day);
  usePolling(res.reload);
  const data = res.data;
  const isToday = day === today;

  const stats = data?.stats;
  const visibleCount = data ? data.appointments.filter(isActive).length : 0;

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
        <TodaySkeleton />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile
              value={stats!.appointments}
              label={isToday ? t('stats.appointmentsToday') : t('stats.appointments')}
            />
            <StatTile value={stats!.confirmed} label={t('stats.confirmed')} tone="brand" />
            <StatTile value={stats!.noReply} label={t('stats.noReply')} />
            <StatTile
              value={stats!.refilledFromWaitlist}
              label={isToday ? t('stats.refilledToday') : t('stats.refilledDay')}
              tone="refill"
            />
          </div>

          <div className="flex flex-col gap-[18px] lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_auto_1fr] lg:items-start lg:gap-x-[18px] lg:gap-y-3.5">
            <div className="flex flex-col gap-3.5 lg:col-start-2 lg:row-start-1">
              <DoThisFirst count={data.whatsappDue} />
              <NeedsYou count={data.outcomesToMark} />
            </div>

            <section
              aria-labelledby="day-heading"
              className="flex min-w-0 flex-col gap-3.5 lg:col-start-1 lg:row-span-3 lg:row-start-1"
            >
              <h2 id="day-heading" className="m-0 text-xl font-semibold">
                {f.dayLong(`${day}T12:00:00Z`)}
              </h2>
              {visibleCount === 0 ? (
                <EmptyState
                  icon={<CalendarDays size={22} />}
                  title={isToday ? t('empty.titleToday') : t('empty.title')}
                  body={t('empty.body')}
                  action={
                    <ButtonLink href="/app/book" size="lg">
                      <Plus size={18} strokeWidth={2.5} aria-hidden="true" />
                      {t('empty.cta')}
                    </ButtonLink>
                  }
                />
              ) : desktop ? (
                <CalendarGrid
                  appointments={data.appointments}
                  staff={data.staff}
                  timezone={timezone}
                  onOpen={setOpen}
                />
              ) : (
                <>
                  <StaffFilter staff={data.staff} value={staffId} onChange={setStaffId} />
                  <Agenda
                    appointments={data.appointments}
                    timezone={timezone}
                    staffId={staffId}
                    onOpen={setOpen}
                  />
                </>
              )}
            </section>

            <div className="lg:col-start-2 lg:row-start-2">
              <WaitlistActivityCard timezone={timezone} />
            </div>
          </div>
        </>
      )}

      <AppointmentSheet
        appointment={open}
        timezone={timezone}
        onClose={() => setOpen(null)}
        onCancelled={(message) => {
          setOpen(null);
          toast.show(message);
          res.reload();
          refreshSummary();
        }}
      />
    </>
  );
}
