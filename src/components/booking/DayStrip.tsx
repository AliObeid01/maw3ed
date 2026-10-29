'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { IconButton } from '@/components/ui/IconButton';
import { radioGroupKeyDown } from '@/components/ui/radioKeys';
import type { Slot } from '@/lib/api/booking';
import { STRIP_PAGE } from '@/lib/booking/slots';
import { cn } from '@/lib/cn';
import { useBookingFormat } from './useBookingFormat';

/**
 * The next days inside the booking window as a radio group of date pills (board 1.3), seven per page.
 * Days without free times are disabled. Arrow keys move between days that have times.
 */
export function DayStrip({
  days,
  byDay,
  selected,
  onSelect,
  timezone,
}: {
  days: string[];
  byDay: Record<string, Slot[]>;
  selected?: string;
  onSelect: (day: string) => void;
  timezone: string;
}) {
  const t = useTranslations('booking.time');
  const f = useBookingFormat(timezone);
  const labelId = useId();
  const pages = Math.ceil(days.length / STRIP_PAGE);
  const selectedIndex = selected ? days.indexOf(selected) : -1;
  const [page, setPage] = useState(Math.max(0, Math.floor(selectedIndex / STRIP_PAGE)));
  const visible = days.slice(page * STRIP_PAGE, (page + 1) * STRIP_PAGE);
  const enabled = visible.filter((d) => (byDay[d]?.length ?? 0) > 0);
  const tabStop = visible.includes(selected ?? '') ? selected : enabled[0];

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <span id={labelId} className="text-[15px] font-semibold">
          {f.dayMonth(visible[0]!)} – {f.dayMonth(visible[visible.length - 1]!)}
          <span className="sr-only"> ({t('dayStripLabel')})</span>
        </span>
        <span className="flex gap-2">
          <IconButton label={t('prevWeek')} disabled={page === 0} onClick={() => setPage(page - 1)}>
            <ChevronLeft size={20} aria-hidden="true" className="rtl:-scale-x-100" />
          </IconButton>
          <IconButton
            label={t('nextWeek')}
            disabled={page >= pages - 1}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight size={20} aria-hidden="true" className="rtl:-scale-x-100" />
          </IconButton>
        </span>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        onKeyDown={(e) => radioGroupKeyDown(e, (i) => onSelect(enabled[i]!))}
        className="grid grid-cols-7 gap-0.5 md:gap-2"
      >
        {visible.map((day) => {
          const count = byDay[day]?.length ?? 0;
          const checked = day === selected;
          return (
            <button
              key={day}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={
                count > 0
                  ? t('dayAvailable', { date: f.ymd(day), count })
                  : t('dayFull', { date: f.ymd(day) })
              }
              disabled={count === 0}
              tabIndex={day === tabStop ? 0 : -1}
              onClick={() => onSelect(day)}
              className={cn(
                'flex h-[68px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-input border transition-colors duration-200 ease-out',
                checked
                  ? 'border-brand bg-brand text-white'
                  : 'border-line bg-surface text-ink hover:border-brand',
                count === 0 && 'cursor-not-allowed bg-canvas text-subtle hover:border-line',
              )}
            >
              <span aria-hidden="true" className="text-xs font-medium">
                {f.weekday(day)}
              </span>
              <span aria-hidden="true" className="text-lg font-semibold tabular-nums">
                {f.dayNumber(day)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
