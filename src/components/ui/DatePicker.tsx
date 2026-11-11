'use client';

import { DateTime } from 'luxon';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useFormatter, useLocale, useTimeZone, useTranslations, type DateTimeFormatOptions } from 'next-intl';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { DEFAULT_TIMEZONE } from '@/lib/auth/timezones';
import { cn } from '@/lib/cn';
import {
  addMonthsYmd,
  clampYmd,
  isDisabledYmd,
  isYmd,
  monthHasAllowedDay,
  monthMatrix,
  monthStart,
  navigateYmd,
  weekdayOrder,
  ymdOf,
  type GridKey,
} from '@/lib/pickers/monthGrid';
import { describedByIds, FieldShell } from './Field';
import { PickerSurface } from './pickers/PickerSurface';
import { PickerTrigger } from './pickers/PickerTrigger';

/**
 * A date as `yyyy-MM-dd` in the BUSINESS time zone, picked from a month grid. All the date maths is Luxon on plain
 * dates (see lib/pickers/monthGrid.ts), so the browser's zone never moves a day. Weeks start on Monday, like the
 * business views.
 */
const WEEK_START = 1;

const MONTH_YEAR: DateTimeFormatOptions = { month: 'long', year: 'numeric' };
const WEEKDAY_LONG: DateTimeFormatOptions = { weekday: 'long' };
const FULL_DAY: DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
};

/** The chosen day in the app's own format: "10 Jul 2036", Latin digits in both languages. */
export function useDayText() {
  const format = useFormatter();
  return (ymd: string) =>
    isYmd(ymd)
      ? format.dateTime(new Date(`${ymd}T12:00:00Z`), {
          timeZone: 'UTC',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          numberingSystem: 'latn',
        })
      : '';
}

/** Today's date in the business time zone as `yyyy-MM-dd`. */
export function useBusinessToday(override?: string): string {
  const zone = useTimeZone() ?? DEFAULT_TIMEZONE;
  return override && isYmd(override) ? override : ymdOf(DateTime.now().setZone(zone));
}

export type DatePickerControlProps = {
  id: string;
  value: string;
  onChange: (ymd: string) => void;
  /** Accessible name of the field (the visible label, or "<label>, date" inside a date-time group). */
  label: string;
  name?: string;
  min?: string;
  max?: string;
  /** Today in the business zone; defaults to now in the zone next-intl was given. */
  today?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  /** Offer a "Clear" button that calls `onChange('')`. */
  clearable?: boolean;
  placeholder?: string;
  describedBy?: string;
  className?: string;
};

export function DatePickerControl({
  id,
  value,
  onChange,
  label,
  name,
  min,
  max,
  today,
  error,
  disabled,
  required,
  clearable,
  placeholder,
  describedBy,
  className,
}: DatePickerControlProps) {
  const t = useTranslations('ui.pickers');
  const dayText = useDayText();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = `${id}-panel`;
  return (
    <>
      <PickerTrigger
        ref={triggerRef}
        id={id}
        name={name}
        data-value={value}
        text={dayText(value)}
        placeholder={placeholder ?? t('selectDate')}
        icon={<CalendarDays size={18} />}
        expanded={open}
        popup="dialog"
        controlsId={panelId}
        invalid={Boolean(error)}
        required={required}
        disabled={disabled}
        aria-label={label}
        aria-describedby={describedBy}
        className={className}
        onClick={() => setOpen((o) => !o)}
      />
      <PickerSurface
        open={open}
        onOpenChange={setOpen}
        anchorRef={triggerRef}
        title={label}
        closeLabel={t('close')}
        width={328}
      >
        <CalendarPanel
          id={panelId}
          value={value}
          min={min}
          max={max}
          today={today}
          clearable={clearable}
          onPick={(ymd) => {
            setOpen(false);
            if (ymd !== value) onChange(ymd);
          }}
        />
      </PickerSurface>
    </>
  );
}

/** A labelled date field: `value` is `yyyy-MM-dd` (or empty). */
export function DatePicker({
  label,
  value,
  onChange,
  name,
  min,
  max,
  today,
  disabled,
  required,
  clearable,
  error,
  hint,
  id,
  className,
  wrapperClassName,
}: {
  label: ReactNode;
  value: string;
  onChange: (ymd: string) => void;
  name?: string;
  min?: string;
  max?: string;
  today?: string;
  disabled?: boolean;
  required?: boolean;
  clearable?: boolean;
  error?: string;
  hint?: string;
  id?: string;
  className?: string;
  wrapperClassName?: string;
}) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldShell id={fieldId} label={label} error={error} hint={hint} className={wrapperClassName}>
      <DatePickerControl
        id={fieldId}
        label={typeof label === 'string' ? label : ''}
        value={value}
        onChange={onChange}
        name={name}
        min={min}
        max={max}
        today={today}
        error={error}
        disabled={disabled}
        required={required}
        clearable={clearable}
        describedBy={describedByIds(fieldId, error, hint, undefined)}
        className={className}
      />
    </FieldShell>
  );
}

export function CalendarPanel({
  id,
  value,
  min,
  max,
  today: todayProp,
  clearable,
  shortcuts,
  onPick,
}: {
  id: string;
  value: string;
  min?: string;
  max?: string;
  today?: string;
  clearable?: boolean;
  /** Quick jumps shown above the footer (the Today header: yesterday, tomorrow, last week, next week). */
  shortcuts?: { label: string; ymd: string }[];
  onPick: (ymd: string) => void;
}) {
  const t = useTranslations('ui.pickers');
  const format = useFormatter();
  const locale = useLocale();
  const rtl = locale === 'ar';
  const today = useBusinessToday(todayProp);
  const [focusYmd, setFocusYmd] = useState(() =>
    clampYmd(isYmd(value) ? value : today, min, max),
  );
  const [viewMonth, setViewMonth] = useState(() => monthStart(focusYmd));
  const gridRef = useRef<HTMLDivElement>(null);
  // Focus the day on open and after a keyboard move, never after a click on the month arrows.
  const focusDay = useRef(true);

  // Latin digits in both languages, names in the app language, all on plain UTC dates (no zone shifts).
  const fmt = (ymd: string, options: DateTimeFormatOptions) =>
    format.dateTime(new Date(`${ymd}T12:00:00Z`), {
      timeZone: 'UTC',
      numberingSystem: 'latn',
      ...options,
    });

  const month = Number(viewMonth.slice(5, 7));
  const year = Number(viewMonth.slice(0, 4));
  const rows = monthMatrix(year, month, { weekStart: WEEK_START, min, max });
  const hasPrev = monthHasAllowedDay(addMonthsYmd(viewMonth, -1), min, max);
  const hasNext = monthHasAllowedDay(addMonthsYmd(viewMonth, 1), min, max);

    useEffect(() => {
    if (!focusDay.current) return;
    focusDay.current = false;
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-ymd="${focusYmd}"]`)
      ?.focus({ preventScroll: true });
  }, [focusYmd, viewMonth]);

  const goTo = (ymd: string) => {
    focusDay.current = true;
    setFocusYmd(ymd);
    setViewMonth(monthStart(ymd));
  };

  const shiftMonth = (by: 1 | -1) => {
    const target = addMonthsYmd(viewMonth, by);
    const inView = clampYmd(addMonthsYmd(focusYmd, by), min, max);
    setViewMonth(monthStart(target));
    setFocusYmd(monthStart(inView) === monthStart(target) ? inView : clampYmd(target, min, max));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') return; // the focused day is a button: its click picks it
    const swap = rtl ? { ArrowLeft: 'ArrowRight', ArrowRight: 'ArrowLeft' } : {};
    const key = (swap[e.key as keyof typeof swap] ?? e.key) as GridKey;
    if (
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(key)
    )
      return;
    e.preventDefault();
    goTo(navigateYmd(focusYmd, key, { shift: e.shiftKey, weekStart: WEEK_START, min, max }));
  };

  const Prev = rtl ? ChevronRight : ChevronLeft;
  const Next = rtl ? ChevronLeft : ChevronRight;
  const todayAllowed = !isDisabledYmd(today, min, max);
  const weekdayStyle = locale === 'ar' ? 'narrow' : 'short';
  // 2024-01-01 is a Monday: a fixed reference for the column headers.
  const weekdayDate = (iso: number) => `2024-01-${String(iso).padStart(2, '0')}`;
  const stepper =
    'inline-flex size-11 shrink-0 items-center justify-center rounded-btn text-ink transition-colors duration-150 ease-out hover:bg-canvas disabled:cursor-not-allowed disabled:text-subtle disabled:opacity-50 disabled:hover:bg-transparent md:size-10';

  return (
    <div id={id} className="flex w-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label={t('previousMonth')}
          disabled={!hasPrev}
          onClick={() => shiftMonth(-1)}
          className={stepper}
        >
          <Prev size={20} aria-hidden="true" />
        </button>
        <h3
          aria-live="polite"
          className="m-0 min-w-0 flex-1 truncate text-center text-base font-semibold"
        >
          {fmt(viewMonth, MONTH_YEAR)}
        </h3>
        <button
          type="button"
          aria-label={t('nextMonth')}
          disabled={!hasNext}
          onClick={() => shiftMonth(1)}
          className={stepper}
        >
          <Next size={20} aria-hidden="true" />
        </button>
      </div>
      <div
        ref={gridRef}
        role="grid"
        aria-label={fmt(viewMonth, MONTH_YEAR)}
        onKeyDown={onKeyDown}
      >
        <div role="row" className="grid grid-cols-7">
          {weekdayOrder(WEEK_START).map((iso) => (
            <div
              key={iso}
              role="columnheader"
              aria-label={fmt(weekdayDate(iso), WEEKDAY_LONG)}
              className="flex h-9 items-center justify-center text-xs font-semibold text-muted"
            >
              {fmt(weekdayDate(iso), { weekday: weekdayStyle })}
            </div>
          ))}
        </div>
        {rows.map((row) => (
          <div key={row[0]!.ymd} role="row" className="grid grid-cols-7">
            {row.map((cell) => {
              if (!cell.inMonth) return <div key={cell.ymd} role="gridcell" aria-hidden="true" />;
              const selected = cell.ymd === value;
              const isToday = cell.ymd === today;
              return (
                <div key={cell.ymd} role="gridcell" aria-selected={selected} className="flex justify-center">
                  <button
                    type="button"
                    data-ymd={cell.ymd}
                    tabIndex={cell.ymd === focusYmd ? 0 : -1}
                    data-picker-host={cell.ymd === focusYmd ? "" : undefined}
                    disabled={cell.disabled}
                    aria-current={isToday ? 'date' : undefined}
                    aria-label={fmt(cell.ymd, FULL_DAY)}
                    onClick={() => onPick(cell.ymd)}
                    className={cn(
                      'inline-flex size-11 items-center justify-center rounded-btn text-base tabular-nums transition-colors duration-150 ease-out md:size-10 md:text-sm',
                      'hover:bg-canvas focus-visible:outline-offset-[-2px]',
                      isToday && !selected && 'font-semibold text-brand ring-1 ring-brand ring-inset',
                      selected && 'bg-brand font-semibold text-white hover:bg-brand-hover',
                      cell.disabled && 'cursor-not-allowed text-subtle opacity-50 hover:bg-transparent',
                    )}
                  >
                    {cell.day}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {shortcuts?.length ? (
        <div className="grid grid-cols-2 gap-1.5 border-t border-line pt-2">
          {shortcuts.map((s) => (
            <button
              key={s.label}
              type="button"
              disabled={isDisabledYmd(s.ymd, min, max)}
              onClick={() => onPick(s.ymd)}
              className="inline-flex h-11 items-center justify-center rounded-btn border border-line bg-surface px-3 text-sm font-medium transition-colors duration-150 ease-out hover:bg-canvas disabled:cursor-not-allowed disabled:text-subtle disabled:opacity-50"
            >
              {s.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
        <button
          type="button"
          disabled={!todayAllowed}
          onClick={() => onPick(today)}
          className="inline-flex h-11 items-center rounded-btn px-3 text-sm font-semibold text-brand transition-colors duration-150 ease-out hover:bg-brand-soft disabled:cursor-not-allowed disabled:text-subtle disabled:hover:bg-transparent"
        >
          {t('today')}
        </button>
        {clearable && value ? (
          <button
            type="button"
            onClick={() => onPick('')}
            className="inline-flex h-11 items-center rounded-btn px-3 text-sm font-semibold text-muted transition-colors duration-150 ease-out hover:bg-canvas"
          >
            {t('clear')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
