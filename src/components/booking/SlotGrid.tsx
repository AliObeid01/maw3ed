'use client';

import { useTranslations } from 'next-intl';
import { radioGroupKeyDown } from '@/components/ui/radioKeys';
import type { Slot } from '@/lib/api/booking';
import { findSlotByLocalTime, partitionByDayPart } from '@/lib/booking/slots';
import { cn } from '@/lib/cn';
import { useBookingFormat } from './useBookingFormat';

/**
 * Times of one day as a labelled radio group (arrow keys move and select, Tab leaves the group), split into
 * morning / afternoon / evening. `struckTimes` are shown disabled and crossed out (the slot that was just taken).
 */
export function SlotGrid({
  slots,
  timezone,
  selectedTime,
  onSelect,
  labelId,
  struckTimes = [],
}: {
  slots: Slot[];
  timezone: string;
  /** Time token of the selected slot (`slotTime`, or a plain `HH:mm` from an old link). */
  selectedTime?: string;
  onSelect: (slot: Slot) => void;
  /** Id of the element that names this group. */
  labelId: string;
  struckTimes?: string[];
}) {
  const t = useTranslations('booking.time');
  const f = useBookingFormat(timezone);
  const groups = partitionByDayPart(slots, timezone);
  const flat = groups.flatMap((g) => g.slots);
  // The ONE selected slot: an offset token names an instant; a plain HH:mm (old link) names the first slot at that
  // wall time, so the repeated hour of a DST fall-back never shows two checked radios.
  const selected = selectedTime ? findSlotByLocalTime(flat, timezone, selectedTime) : undefined;
  // Roving tabindex: the selected time, else the first one.
  const tabStop = selected ?? flat[0];

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      onKeyDown={(e) => radioGroupKeyDown(e, (i) => onSelect(flat[i]!))}
      className="flex flex-col gap-4"
    >
      {struckTimes.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {struckTimes.map((time) => (
            <button
              key={time}
              type="button"
              role="radio"
              aria-checked={false}
              disabled
              className="h-11 min-w-[76px] rounded-btn border border-divider bg-divider px-4 text-[15px] text-subtle line-through"
            >
              <bdi dir="ltr" className="tabular-nums">
                {time}
              </bdi>
            </button>
          ))}
        </div>
      ) : null}
      {groups.map((group) => (
        <div key={group.part} className="flex flex-col gap-2.5">
          <span className="text-[13px] font-semibold tracking-[0.08em] text-muted uppercase">
            {t(group.part)}
          </span>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {group.slots.map((slot) => {
              const checked = slot === selected;
              return (
                <button
                  key={slot.startAt}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={slot === tabStop ? 0 : -1}
                  onClick={() => onSelect(slot)}
                  className={cn(
                    'h-11 rounded-btn border px-3 text-[15px] font-medium tabular-nums transition-colors duration-200 ease-out',
                    checked
                      ? 'border-ink bg-ink text-white'
                      : 'border-line bg-surface text-ink hover:border-brand',
                  )}
                >
                  <bdi dir="ltr">{f.time(slot.startAt)}</bdi>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
