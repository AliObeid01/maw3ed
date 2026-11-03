'use client';

import { Plus, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TimeField } from '@/components/ui/DateTimeFields';
import { Sheet } from '@/components/ui/Sheet';
import { cn } from '@/lib/cn';
import {
  MAX_INTERVALS_PER_DAY,
  WEEK_ORDER,
  copyDay,
  endFromInput,
  endToInput,
  suggestInterval,
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
      <TimeField
        className="min-w-0 flex-1"
        label={t('opens')}
        value={interval.start}
        invalid={invalid}
        onChange={(start) => onChange({ ...interval, start })}
      />
      <TimeField
        className="min-w-0 flex-1"
        label={t('closes')}
        value={endToInput(interval.end)}
        invalid={invalid}
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
  const [draft, setDraft] = useState<DayInterval[]>(() => week[weekday]!.map((i) => ({ ...i })));
  const [copyTo, setCopyTo] = useState<number[]>([]);

  const problems = validateDay(draft);
  const problemText: Record<DayProblem, string> = {
    invalid: t('problem.invalid'),
    endBeforeStart: t('problem.endBeforeStart'),
    overlap: t('problem.overlap'),
    tooMany: t('problem.tooMany', { max: MAX_INTERVALS_PER_DAY }),
  };

  const apply = () => {
    if (problems.length > 0) return;
    const next = week.map((day, index) => (index === weekday ? draft : day));
    onApply(copyDay(next, weekday, copyTo));
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

      {problems.length > 0 ? (
        <ul role="alert" className="m-0 flex list-none flex-col gap-1 p-0">
          {problems.map((p) => (
            <li key={p} className="text-[13px] font-medium text-danger">
              {problemText[p]}
            </li>
          ))}
        </ul>
      ) : null}

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
        <Button size="lg" block disabled={problems.length > 0} onClick={apply}>
          {t('apply')}
        </Button>
      </div>
    </div>
  );
}
