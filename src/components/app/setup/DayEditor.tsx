'use client';

import { Moon, Plus, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { TimePicker } from '@/components/ui/TimePicker';
import { Sheet } from '@/components/ui/Sheet';
import { cn } from '@/lib/cn';
import {
  MAX_INTERVALS_PER_DAY,
  WEEK_ORDER,
  copyDay,
  endFromInput,
  nextWeekday,
  openPastMidnight,
  overnightIndex,
  sortDay,
  suggestInterval,
  toMinutes,
  validateDay,
  type DayInterval,
  type DayProblem,
  type Week,
} from '@/lib/setup/hours';

/** Long weekday name for 0 = Sunday ... 6 = Saturday, in the UI locale. */
export function useWeekdayName() {
  const format = useFormatter();
  const name = (weekday: number, style: 'long' | 'short') =>
    format.dateTime(new Date(Date.UTC(2024, 0, 7 + weekday)), { weekday: style, timeZone: 'UTC' });
  return {
    long: (weekday: number) => name(weekday, 'long'),
    short: (weekday: number) => name(weekday, 'short'),
  };
}

function IntervalRow({
  interval,
  invalid,
  onChange,
  onRemove,
}: {
  interval: DayInterval;
  invalid: boolean;
  onChange: (next: DayInterval) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('app.hours.editor');
  return (
    <li className="flex items-end gap-2">
      <TimePicker
        wrapperClassName="min-w-0 flex-1"
        label={t('opens')}
        value={interval.start}
        invalid={invalid}
        onChange={(start) => onChange({ ...interval, start })}
      />
      <TimePicker
        wrapperClassName="min-w-0 flex-1"
        label={t('closes')}
        value={interval.end}
        invalid={invalid}
        endOfDay
        onChange={(end) => onChange({ ...interval, end: endFromInput(end) })}
      />
      <button
        type="button"
        aria-label={t('remove')}
        onClick={onRemove}
        className="flex size-[52px] shrink-0 items-center justify-center rounded-btn text-muted transition-colors duration-200 ease-out hover:bg-canvas hover:text-danger"
      >
        <X size={20} aria-hidden="true" />
      </button>
    </li>
  );
}

/**
 * One day's working intervals in a sheet: edit, add, remove, then optionally copy to other days.
 * Nothing is saved until the page's "Save hours" button; this only updates the local week.
 */
export function DayEditor({
  weekday,
  week,
  onApply,
  onClose,
}: {
  weekday: number | null;
  week: Week;
  onApply: (next: Week) => void;
  onClose: () => void;
}) {
  const t = useTranslations('app.hours.editor');
  const dayName = useWeekdayName();
  return (
    <Sheet
      open={weekday !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={
        weekday === null ? t('title', { day: '' }) : t('title', { day: dayName.long(weekday) })
      }
      closeLabel={t('close')}
    >
      {weekday === null ? null : (
        <DayEditorBody
          key={weekday}
          weekday={weekday}
          week={week}
          onApply={onApply}
          onClose={onClose}
        />
      )}
    </Sheet>
  );
}

function DayEditorBody({
  weekday,
  week,
  onApply,
  onClose,
}: {
  weekday: number;
  week: Week;
  onApply: (next: Week) => void;
  onClose: () => void;
}) {
  const t = useTranslations('app.hours.editor');
  const dayName = useWeekdayName();
  const [draft, setDraft] = useState<DayInterval[]>(() =>
    sortDay(week[weekday]!.map((i) => ({ start: i.start, end: endFromInput(i.end) }))),
  );
  const [copyTo, setCopyTo] = useState<number[]>([]);
  const [declined, setDeclined] = useState<string>();
  const [overnightError, setOvernightError] = useState<string>();

  // Closes earlier than Opens on one entry is the "open past midnight" case: offer the split instead of an error.
  const overnight = overnightIndex(draft);
  const overnightEntry = overnight >= 0 ? draft[overnight]! : undefined;
  const overnightKey = overnightEntry ? `${overnightEntry.start}-${overnightEntry.end}` : undefined;
  const offerOvernight = overnightEntry !== undefined && declined !== overnightKey;
  const nextDayName = dayName.long(nextWeekday(weekday));
  const allProblems = validateDay(draft);
  const otherBad = draft.some((i, k) => k !== overnight && toMinutes(i.end) <= toMinutes(i.start));
  const problems = allProblems.filter((p) => p !== 'endBeforeStart' || !offerOvernight || otherBad);
  const problemText: Record<DayProblem, string> = {
    invalid: t('problem.invalid'),
    endBeforeStart: t('problem.endBeforeStart'),
    overlap: t('problem.overlap'),
    tooMany: t('problem.tooMany', { max: MAX_INTERVALS_PER_DAY }),
  };

  const apply = () => {
    if (problems.length > 0 || offerOvernight) return;
    const next = week.map((day, index) => (index === weekday ? sortDay(draft) : day));
    onApply(copyDay(next, weekday, copyTo));
    onClose();
  };

  const confirmOvernight = () => {
    const result = openPastMidnight(week, weekday, draft, overnight, copyTo);
    if (!result.ok) {
      setOvernightError(
        result.problem === 'tooMany'
          ? t('overnight.tooMany', {
              day: dayName.long(result.weekday),
              max: MAX_INTERVALS_PER_DAY,
            })
          : t('problem.overlap'),
      );
      return;
    }
    onApply(result.week);
    onClose();
  };

  return (
    <div className="flex flex-col gap-4">
      {draft.length === 0 ? (
        <p className="m-0 rounded-input bg-canvas px-3.5 py-3 text-[15px] text-muted">
          {t('dayOff')}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {draft.map((interval, index) => (
            <IntervalRow
              key={index}
              interval={interval}
              invalid={validateDay([interval]).length > 0 || problems.includes('overlap')}
              onChange={(next) => setDraft((d) => d.map((x, i) => (i === index ? next : x)))}
              onRemove={() => setDraft((d) => d.filter((_, i) => i !== index))}
            />
          ))}
        </ul>
      )}

      {/* One persistent polite live region (a region that mounts together with its text is often not announced):
          when the prompt appears, screen-reader users hear that Apply is off until they choose. */}
      <p aria-live="polite" data-testid="overnight-announcer" className="sr-only">
        {offerOvernight && overnightEntry ? t('overnight.announce') : ''}
      </p>
      {offerOvernight && overnightEntry ? (
        <div role="group" aria-labelledby="overnight-title" className="flex flex-col gap-3">
          <Callout icon={<Moon />}>
            <p id="overnight-title" className="m-0 font-semibold">
              {t('overnight.title', { to: overnightEntry.end })}
            </p>
            <p className="m-0 mt-1">
              {t('overnight.body', {
                day: dayName.long(weekday),
                from: overnightEntry.start,
                nextDay: nextDayName,
                to: overnightEntry.end,
              })}
            </p>
          </Callout>
          {copyTo.length > 0 ? (
            <p data-testid="overnight-copy-hint" className="m-0 text-[13px] text-muted">
              {t('overnight.copyHint')}
            </p>
          ) : null}
          {overnightError ? (
            <p role="alert" className="m-0 text-[13px] font-medium text-danger">
              {overnightError}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2.5">
            <Button variant="secondary" block onClick={() => setDeclined(overnightKey)}>
              {t('overnight.keep')}
            </Button>
            <Button block onClick={confirmOvernight}>
              {t('overnight.confirm', { to: overnightEntry.end })}
            </Button>
          </div>
        </div>
      ) : null}

      {problems.length > 0 ? (
        <ul role="alert" className="m-0 flex list-none flex-col gap-1 p-0">
          {problems.map((p) => (
            <li key={p} className="text-[13px] font-medium text-danger">
              {problemText[p]}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="m-0 text-[13px] text-muted">{t('midnightHint')}</p>

      <Button
        variant="secondary"
        block
        disabled={draft.length >= MAX_INTERVALS_PER_DAY}
        onClick={() => setDraft((d) => [...d, suggestInterval(d)])}
      >
        <Plus size={18} strokeWidth={2.5} aria-hidden="true" />
        {t('add')}
      </Button>

      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="mb-2 p-0 text-[15px] font-medium">{t('copyTo')}</legend>
        <div className="flex flex-wrap gap-2">
          {WEEK_ORDER.filter((d) => d !== weekday).map((d) => {
            const on = copyTo.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => setCopyTo((c) => (on ? c.filter((x) => x !== d) : [...c, d]))}
                className={cn(
                  'min-h-11 rounded-btn px-4 text-[15px] transition-colors duration-200 ease-out',
                  on
                    ? 'bg-brand font-medium text-white'
                    : 'border border-line bg-surface text-ink hover:bg-canvas',
                )}
              >
                {dayName.short(d)}
              </button>
            );
          })}
        </div>
        {copyTo.length > 0 ? (
          <p className="m-0 text-[13px] text-muted">
            {t('copyNote', { day: dayName.long(weekday) })}
          </p>
        ) : null}
      </fieldset>

      {/* A grid, not a flex row: `block` buttons are w-full and shrink-0, so in a flex row each one claimed the
          whole sheet width and Apply ran past the edge (the F62 bug). Two equal columns can never overflow. */}
      <div className="grid grid-cols-2 gap-2.5 pt-1">
        <Button variant="secondary" size="lg" block onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button size="lg" block disabled={problems.length > 0 || offerOvernight} onClick={apply}>
          {t('apply')}
        </Button>
      </div>
    </div>
  );
}
