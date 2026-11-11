'use client';

import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useFormatter, useTranslations, type DateTimeFormatOptions } from 'next-intl';
import { useRef, useState } from 'react';
import { CalendarPanel } from '@/components/ui/DatePicker';
import { IconButton } from '@/components/ui/IconButton';
import { PickerSurface } from '@/components/ui/pickers/PickerSurface';
import { cn } from '@/lib/cn';
import { DAY_MAX, DAY_MIN, dayShortcuts, weekOf } from '@/lib/dashboard/dayPicker';

// Plain UTC dates with Latin digits in both languages: the viewed day is a business-zone date string, so the
// browser's zone can never move it.
const SHORT: DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };
const FULL: DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
const NO_YEAR: DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
const WEEKDAY: DateTimeFormatOptions = { weekday: 'short' };
const DATE_NUM: DateTimeFormatOptions = { day: 'numeric' };
const noon = (ymd: string) => new Date(`${ymd}T12:00:00Z`);

function useDayFormat() {
  const format = useFormatter();
  return (ymd: string, options: DateTimeFormatOptions) =>
    format.dateTime(noon(ymd), { timeZone: 'UTC', numberingSystem: 'latn', ...options });
}

/**
 * Today header: previous / next day, the date itself (opens a month calendar for any past or future day) and a
 * Today button. `day` and `today` are `yyyy-MM-dd` in the business time zone.
 */
export function DayNav({
  day,
  today,
  onPick,
  onShift,
  onToday,
}: {
  day: string;
  today: string;
  onPick: (ymd: string) => void;
  onShift: (delta: number) => void;
  onToday: () => void;
}) {
  const t = useTranslations('app.today.dayNav');
  const tp = useTranslations('ui.pickers');
  const fmt = useDayFormat();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isToday = day === today;
  const shortcuts = dayShortcuts(today).map((s) => ({ label: t(s.id), ymd: s.ymd }));
  return (
    <div role="group" aria-label={t('label')} className="flex w-full items-center gap-1.5 sm:w-auto">
      <IconButton label={t('prev')} onClick={() => onShift(-1)}>
        <ChevronLeft size={18} aria-hidden="true" className="rtl:-scale-x-100" />
      </IconButton>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t('pick')}: ${fmt(day, FULL)}`}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-btn border border-line bg-surface px-2.5 text-[15px] font-medium transition-colors duration-200 ease-out hover:bg-canvas sm:flex-none',
          open && 'border-brand',
        )}
      >
        <CalendarDays size={17} aria-hidden="true" className="hidden shrink-0 text-muted sm:block" />
        <span className="truncate tabular-nums">{fmt(day, SHORT)}</span>
        <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-muted" />
      </button>
      <IconButton label={t('next')} onClick={() => onShift(1)}>
        <ChevronRight size={18} aria-hidden="true" className="rtl:-scale-x-100" />
      </IconButton>
      <button
        type="button"
        onClick={onToday}
        aria-current={isToday ? 'date' : undefined}
        disabled={isToday}
        className="h-11 rounded-btn border border-line bg-surface px-4 text-[15px] font-medium transition-colors duration-200 ease-out hover:bg-canvas disabled:cursor-default disabled:border-transparent disabled:bg-transparent disabled:opacity-100 disabled:font-semibold disabled:text-brand"
      >
        {t('today')}
      </button>
      <PickerSurface
        open={open}
        onOpenChange={setOpen}
        anchorRef={triggerRef}
        title={t('pickerTitle')}
        closeLabel={tp('close')}
        width={328}
      >
        <CalendarPanel
          id="day-nav-calendar"
          value={day}
          min={DAY_MIN}
          max={DAY_MAX}
          today={today}
          shortcuts={shortcuts}
          onPick={(ymd) => {
            setOpen(false);
            if (ymd !== day) onPick(ymd);
          }}
        />
      </PickerSurface>
    </div>
  );
}

/** Phones only: the seven days of the viewed week as chips (weekday + date), today marked, tap to switch. */
export function WeekStrip({
  day,
  today,
  onPick,
}: {
  day: string;
  today: string;
  onPick: (ymd: string) => void;
}) {
  const t = useTranslations('app.today.dayNav');
  const fmt = useDayFormat();
  return (
    <div role="group" aria-label={t('weekLabel')} className="grid grid-cols-7 gap-1 md:hidden">
      {weekOf(day).map((ymd) => {
        const selected = ymd === day;
        return (
          <button
            key={ymd}
            type="button"
            aria-pressed={selected}
            aria-current={ymd === today ? 'date' : undefined}
            aria-label={fmt(ymd, NO_YEAR)}
            onClick={() => onPick(ymd)}
            className={cn(
              'flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-btn border text-xs transition-colors duration-150 ease-out',
              selected
                ? 'border-brand bg-brand font-semibold text-white'
                : 'border-line bg-surface text-muted hover:bg-canvas',
              ymd === today && !selected && 'border-brand text-brand',
            )}
          >
            <span>{fmt(ymd, WEEKDAY)}</span>
            <span className="text-base font-semibold tabular-nums">{fmt(ymd, DATE_NUM)}</span>
          </button>
        );
      })}
    </div>
  );
}
