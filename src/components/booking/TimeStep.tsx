'use client';

import { Globe, TriangleAlert } from 'lucide-react';
import { DateTime } from 'luxon';
import { useId, type Ref } from 'react';
import { useTranslations } from 'next-intl';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Skeleton } from '@/components/ui/Skeleton';
import type { Slot } from '@/lib/api/booking';
import { findSlotByLocalTime, timezonesDiffer } from '@/lib/booking/slots';
import { DayStrip } from './DayStrip';
import { SlotGrid } from './SlotGrid';
import { StepHeading } from './StepHeading';
import { useBookingFormat } from './useBookingFormat';

export type TakenInfo = {
  /** Local `HH:mm` of the slot that was just taken, as the person saw it. */
  time: string;
  /** Local day it was on. */
  day: string;
};

export type TimeStepProps = {
  timezone: string;
  now: Date;
  days: string[];
  byDay: Record<string, Slot[]>;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  day?: string;
  time?: string;
  onPickDay: (day: string) => void;
  onPickSlot: (slot: Slot) => void;
  onBack: () => void;
  headingRef: Ref<HTMLHeadingElement>;
  /** Board 1.6: the chosen slot was taken at submit; `byDay[taken.day]` already holds the fresh slots. */
  taken?: TakenInfo;
  onBookInstead?: () => void;
  onSeeOtherDays?: () => void;
  submitting?: boolean;
  /** Join-the-waitlist page with the service and person prefilled; the action is hidden without it. */
  waitlistHref?: string;
};

/** Boards 1.3 (day strip + times) and 1.6 (slot just taken, fresh times for that day, one tap to rebook). */
export function TimeStep(props: TimeStepProps) {
  const { timezone, now, days, byDay, loading, failed, taken } = props;
  const t = useTranslations('booking');
  const f = useBookingFormat(timezone);
  const labelId = useId();

  if (taken) {
    const fresh = byDay[taken.day] ?? [];
    const dayLabel = f.ymd(taken.day);
    const picked = props.time ? findSlotByLocalTime(fresh, timezone, props.time) : undefined;
    return (
      <section className="flex min-w-0 flex-[999_1_320px] flex-col gap-4.5">
        <StepHeading
          title={t('taken.title')}
          onBack={props.onBack}
          headingRef={props.headingRef}
        />
        <div
          role="alert"
          className="flex items-start gap-3 rounded-[20px] border border-warning-line bg-warning-soft p-4 text-warning-deep"
        >
          <TriangleAlert size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
          <span className="flex flex-col gap-1">
            <span className="text-base font-semibold">
              {t('taken.heading', { time: taken.time })}
            </span>
            <span className="text-sm">{t('taken.body', { day: dayLabel })}</span>
          </span>
        </div>
        {fresh.length > 0 ? (
          <div className="flex flex-col gap-3">
            <span id={labelId} className="text-[15px] font-semibold">
              {t('taken.stillFree', { day: dayLabel })}
            </span>
            <SlotGrid
              slots={fresh}
              timezone={timezone}
              selectedTime={props.time}
              onSelect={props.onPickSlot}
              labelId={labelId}
              struckTimes={[taken.time]}
            />
          </div>
        ) : (
          <p className="m-0 text-[15px] text-muted">{t('taken.none', { day: dayLabel })}</p>
        )}
        <div className="flex flex-col gap-3 sm:flex-row">
          {props.time ? (
            <Button
              size="lg"
              onClick={props.onBookInstead}
              loading={props.submitting}
              className="max-sm:w-full"
            >
              {t('cta.bookInstead', {
                time: picked ? f.time(picked.startAt) : props.time,
              })}
            </Button>
          ) : null}
          <Button
            size="lg"
            variant="secondary"
            onClick={props.onSeeOtherDays}
            disabled={props.submitting}
            className="max-sm:w-full"
          >
            {t('cta.seeOtherDays')}
          </Button>
          {props.waitlistHref ? (
            <ButtonLink href={props.waitlistHref} size="lg" variant="ghost" className="max-sm:w-full">
              {t('waitlist.action')}
            </ButtonLink>
          ) : null}
        </div>
      </section>
    );
  }

  const covered = days.filter((d) => (byDay[d]?.length ?? 0) > 0);
  const daySlots = props.day ? (byDay[props.day] ?? []) : [];
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Offsets differ by date (DST): compare them at the chosen day, not today.
  const refDate = props.day ? new Date(`${props.day}T12:00:00Z`) : now;
  const showZoneNote = !loading && timezonesDiffer(refDate, timezone, deviceZone);
  const offset = DateTime.fromJSDate(refDate, { zone: timezone }).toFormat('Z');

  return (
    <section className="flex min-w-0 flex-[999_1_320px] flex-col gap-4.5">
      <StepHeading title={t('time.title')} onBack={props.onBack} headingRef={props.headingRef} />
      {loading ? (
        <TimeSkeleton />
      ) : failed ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-[20px] bg-canvas p-4">
          <p className="m-0 text-[15px]">{t('time.slotsFailed')}</p>
          <Button variant="secondary" onClick={props.onRetry}>
            {t('errors.retry')}
          </Button>
        </div>
      ) : covered.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-[20px] bg-canvas p-4">
          <p className="m-0 text-[15px] text-muted">{t('time.noTimesAtAll', { days: days.length })}</p>
          {props.waitlistHref ? (
            <>
              <p className="m-0 text-sm">{t('waitlist.body')}</p>
              <ButtonLink href={props.waitlistHref} variant="secondary" className="max-sm:w-full">
                {t('waitlist.action')}
              </ButtonLink>
            </>
          ) : null}
        </div>
      ) : (
        <>
          <DayStrip
            days={days}
            byDay={byDay}
            selected={props.day}
            onSelect={props.onPickDay}
            timezone={timezone}
          />
          {props.day ? (
            <div className="flex flex-col gap-3">
              <span id={labelId} className="sr-only">
                {t('time.timesLabel', { date: f.ymd(props.day) })}
              </span>
              {daySlots.length > 0 ? (
                <SlotGrid
                  slots={daySlots}
                  timezone={timezone}
                  selectedTime={props.time}
                  onSelect={props.onPickSlot}
                  labelId={labelId}
                />
              ) : (
                <p className="m-0 text-[15px] text-muted">{t('time.noTimesDay')}</p>
              )}
            </div>
          ) : (
            <p className="m-0 text-[15px] text-muted">{t('time.pickDay')}</p>
          )}
          {showZoneNote ? (
            <Callout icon={<Globe />}>
              {t('time.timezoneNote', {
                zone: timezone.split('/').pop()!.replaceAll('_', ' '),
                offset,
              })}
            </Callout>
          ) : null}
        </>
      )}
    </section>
  );
}

export function TimeSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <Skeleton className="h-6 w-40" />
      <div className="grid grid-cols-7 gap-0.5 md:gap-2">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-[68px]" />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
        {Array.from({ length: 9 }, (_, i) => (
          <Skeleton key={i} className="h-11 rounded-pill" />
        ))}
      </div>
    </div>
  );
}
