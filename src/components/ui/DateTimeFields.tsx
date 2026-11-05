'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { DatePickerControl } from './DatePicker';
import { TimePickerControl } from './TimePicker';

/**
 * A date plus a 24-hour time (replaces `datetime-local`): the date picker and the time picker side by side. The parent
 * holds `date` (`yyyy-MM-dd`, may be empty) and `time` (`HH:mm`) separately, so a time picked before the date is not lost.
 * Standalone fields live in DatePicker.tsx and TimePicker.tsx.
 */
export function DateTimeField({
  label,
  date,
  time,
  onDateChange,
  onTimeChange,
  name,
  error,
  hint,
  disabled,
  min,
  max,
  today,
}: {
  label: string;
  date: string;
  time: string;
  onDateChange: (ymd: string) => void;
  onTimeChange: (hm: string) => void;
  name?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
  today?: string;
}) {
  const t = useTranslations('ui.fields');
  const id = useId();
  const labelId = `${id}-label`;
  const described = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1.5">
      <span id={labelId} className="text-sm font-medium">
        {label}
      </span>
      {/* Side by side when the field is wide enough for a whole date; stacked in a narrow side panel so no value is cut. */}
      <div className="@container">
        <div className="grid grid-cols-1 gap-2 @[19rem]:grid-cols-[minmax(0,1fr)_7rem]">
        <DatePickerControl
          id={`${id}-date`}
          name={name}
          label={t('date', { label })}
          value={date}
          onChange={onDateChange}
          min={min}
          max={max}
          today={today}
          disabled={disabled}
          error={error}
          describedBy={described}
        />
        <TimePickerControl
          id={`${id}-time`}
          label={t('time', { label })}
          value={time}
          onChange={onTimeChange}
          invalid={Boolean(error)}
          disabled={disabled}
          describedBy={described}
        />
        </div>
      </div>
      {hint && !error ? (
        <p id={`${id}-hint`} className="m-0 text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="m-0 text-[13px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
