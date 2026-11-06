'use client';

import { CircleAlert, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { putStaffHours, type HoursInterval, type StaffMember } from '@/lib/api/setup';
import { cn } from '@/lib/cn';
import { errorKey, invalidFields } from '@/lib/setup/errors';
import {
  WEEK_ORDER,
  continuesFromPrevious,
  validateWeek,
  weekFromApi,
  weekToApi,
  type Week,
} from '@/lib/setup/hours';
import { StickySaveBar } from '../StickySaveBar';
import { useErrorMessage, useSharedText } from '../states';
import { CopyHoursSheet } from './CopyHoursSheet';
import { DayEditor, useWeekdayName } from './DayEditor';

const sameWeek = (a: Week, b: Week) => JSON.stringify(a) === JSON.stringify(b);

/** Board 3.7 "Weekly hours": one row per day with interval chips, "+ Add", and a save button. */
export function WeeklyHours({
  staffId,
  source,
  others,
  initial,
  onSaved,
}: {
  staffId: string;
  /** The person whose hours are shown, and the other schedulable staff the owner can copy them to. */
  source: StaffMember;
  others: StaffMember[];
  initial: HoursInterval[];
  onSaved: (intervals: HoursInterval[]) => void;
}) {
  const t = useTranslations('app.hours');
  const shared = useSharedText();
  const errorText = useErrorMessage();
  const toast = useToast();
  const dayName = useWeekdayName();

  const [baseline, setBaseline] = useState<Week>(() => weekFromApi(initial));
  const [week, setWeek] = useState<Week>(baseline);
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [banner, setBanner] = useState<string>();
  const [copyOpen, setCopyOpen] = useState(false);

  const problems = validateWeek(week);
  const dirty = !sameWeek(week, baseline);
  const hasProblems = Object.keys(problems).length > 0;

  const save = async () => {
    if (pending || hasProblems) return;
    setPending(true);
    setBanner(undefined);
    try {
      const saved = await putStaffHours(staffId, weekToApi(week));
      const next = weekFromApi(saved);
      setBaseline(next);
      setWeek(next);
      onSaved(saved);
      toast.show(t('saved'));
    } catch (error) {
      setBanner(
        invalidFields(error).includes('intervals') && errorKey(error) === 'validation'
          ? t('serverOverlap')
          : errorText(error),
      );
    } finally {
      setPending(false);
    }
  };

  const saveButton = (block: boolean) => (
    <Button
      size="lg"
      block={block}
      loading={pending}
      disabled={!dirty || hasProblems}
      onClick={save}
    >
      {pending ? shared.saving : t('save')}
    </Button>
  );

  return (
    <Card
      as="section"
      aria-labelledby="weekly-hours-title"
      padding="none"
      className="flex min-w-0 flex-[999_1_480px] flex-col px-4 pt-2 pb-4 md:px-[22px]"
    >
      <div className="mt-3.5 mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 id="weekly-hours-title" className="m-0 text-lg font-semibold">
          {t('weekly')}
        </h2>
        {others.length > 0 ? (
          <Button
            variant="secondary"
            onClick={() => setCopyOpen(true)}
            disabled={dirty}
            aria-describedby={dirty ? 'copy-hours-hint' : undefined}
          >
            <Copy size={18} aria-hidden="true" />
            {t('copy.button')}
          </Button>
        ) : null}
        {others.length > 0 && dirty ? (
          <p id="copy-hours-hint" className="m-0 basis-full text-[13px] text-muted">
            {t('copy.saveFirst')}
          </p>
        ) : null}
      </div>
      {banner ? (
        <div role="alert" className="mb-2">
          <Callout tone="danger" icon={<CircleAlert />}>
            {banner}
          </Callout>
        </div>
      ) : null}
      <ul className="m-0 flex list-none flex-col p-0">
        {WEEK_ORDER.map((weekday) => {
          const day = week[weekday]!;
          const dayProblems = problems[weekday];
          const fromNight = continuesFromPrevious(week, weekday);
          return (
            <li
              key={weekday}
              className="grid grid-cols-[1fr_auto] items-center gap-x-3.5 gap-y-1 border-b border-row py-2.5 last:border-b-0 md:grid-cols-[96px_1fr_auto]"
            >
              <span
                className={cn(
                  'col-start-1 row-start-1 text-[15px] font-semibold',
                  day.length === 0 && 'text-muted',
                )}
              >
                {dayName.long(weekday)}
              </span>
              <div className="col-span-2 row-start-2 flex flex-wrap gap-2 md:col-span-1 md:col-start-2 md:row-start-1">
                {day.length === 0 ? (
                  <span className="py-2.5 text-[15px] text-muted">{t('dayOff')}</span>
                ) : (
                  day.map((interval, index) => {
                    const tail = fromNight && index === 0;
                    return (
                      <button
                        key={index}
                        type="button"
                        onClick={() => setEditingDay(weekday)}
                        aria-label={
                          tail
                            ? t('editTail', { day: dayName.long(weekday), to: interval.end })
                            : t('editInterval', {
                                day: dayName.long(weekday),
                                from: interval.start,
                                to: interval.end,
                              })
                        }
                        className="min-h-11 rounded-nav border border-line bg-canvas px-3.5 text-[15px] tabular-nums transition-colors duration-200 ease-out hover:border-brand"
                      >
                        {tail ? (
                          <bdi>{t('continuesUntil', { to: interval.end })}</bdi>
                        ) : (
                          <bdi dir="ltr">
                            {interval.start} – {interval.end}
                          </bdi>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
              <button
                type="button"
                onClick={() => setEditingDay(weekday)}
                aria-label={t('addTo', { day: dayName.long(weekday) })}
                className="col-start-2 row-start-1 min-h-11 rounded-nav px-3 text-sm font-semibold text-brand transition-colors duration-200 ease-out hover:bg-brand-soft md:col-start-3"
              >
                {t('add')}
              </button>
              {dayProblems ? (
                <p
                  role="alert"
                  className="col-span-2 m-0 text-[13px] font-medium text-danger md:col-span-3"
                >
                  {t(`problem.${dayProblems[0]!}`, { max: 6 })}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="mt-3.5 hidden justify-end md:flex">{saveButton(false)}</div>
      {dirty ? <StickySaveBar>{saveButton(true)}</StickySaveBar> : null}

      <CopyHoursSheet source={source} others={others} open={copyOpen} onOpenChange={setCopyOpen} />
      <DayEditor
        weekday={editingDay}
        week={week}
        onApply={setWeek}
        onClose={() => setEditingDay(null)}
      />
    </Card>
  );
}
