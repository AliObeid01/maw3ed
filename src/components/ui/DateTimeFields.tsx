'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { borderFor, control, describedByIds, FieldShell } from './Field';

/**
 * Date and time-of-day controls that look the same in every browser and language.
 *
 * Native `<input type="date">` and `type="time"` render in the browser's locale (US `mm/dd/yyyy`, 12-hour
 * AM/PM on many phones). We keep the native date input, because the phone date picker is the best way to choose a
 * day, but always print the chosen day in the app's own format underneath it. Times of day are two selects
 * (hours 00-23, minutes) so the clock is 24-hour with Latin digits everywhere.
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^(\d{2}):(\d{2})$/;
const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const MINUTE_STEP = 5;
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) =>
  String(i * MINUTE_STEP).padStart(2, '0'),
);

/** The chosen day in the app's own format: "Fri 10 Jul 2036", Latin digits in both languages. */
function useDayText() {
  const format = useFormatter();
  return (ymd: string) =>
    YMD.test(ymd)
      ? format.dateTime(new Date(`${ymd}T12:00:00Z`), {
          timeZone: 'UTC',
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          numberingSystem: 'latn',
        })
      : '';
}

function DatePreview({ id, ymd }: { id: string; ymd: string }) {
  const text = useDayText()(ymd);
  // The line is always in the layout (min height) so choosing a date never moves the fields below it.
  return (
    <p
      id={id}
      aria-live="polite"
      className="m-0 min-h-5 text-[13px] leading-5 font-medium text-ink tabular-nums"
    >
      {text ? <bdi>{text}</bdi> : null}
    </p>
  );
}

type DateInputProps = {
  id: string;
  name?: string;
  value: string;
  onChange: (ymd: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  error?: string;
  hint?: string;
  dir?: 'ltr' | 'rtl';
  'aria-label'?: string;
  className?: string;
};

function DateInput({
  id,
  name,
  value,
  onChange,
  min,
  max,
  disabled,
  error,
  hint,
  dir,
  className,
  ...rest
}: DateInputProps) {
  const previewId = `${id}-day`;
  return (
    <input
      id={id}
      name={name}
      type="date"
      autoComplete="off"
      value={value}
      min={min}
      max={max}
      disabled={disabled}
      dir={dir}
      aria-label={rest['aria-label']}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedByIds(id, error, hint, previewId)}
      onChange={(e) => onChange(e.target.value)}
      className={cn(control, borderFor(error), 'px-3 text-start', className)}
    />
  );
}

/** A labelled date field: native date input plus the chosen day written out in the app's format. */
export function DateField({
  label,
  value,
  onChange,
  name,
  min,
  max,
  disabled,
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
  disabled?: boolean;
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
      <DateInput
        id={fieldId}
        name={name}
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        disabled={disabled}
        error={error}
        hint={hint}
        className={className}
      />
      <DatePreview id={`${fieldId}-day`} ymd={value} />
    </FieldShell>
  );
}

const selectClass = cn(
  control,
  'min-w-0 flex-1 cursor-pointer appearance-none px-2 text-center tabular-nums',
);

/** Two selects, hours 00-23 and minutes, as one left-to-right `HH : mm` unit. `value` is `HH:mm`. */
export function TimeSelects({
  label,
  value,
  onChange,
  invalid,
  disabled,
  idPrefix,
  endOfDay,
}: {
  /** Visible label text; the selects are named "<label>, hours" and "<label>, minutes". */
  label: string;
  value: string;
  onChange: (hm: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  idPrefix?: string;
  /**
   * A closing time: hours run 01-24 and `24` is end of day ("24:00 (midnight)", minutes locked to 00), so nobody
   * needs the old 00:00-means-24:00 trick. 00 is not offered because it would be ambiguous with 24.
   */
  endOfDay?: boolean;
}) {
  const t = useTranslations('ui.fields');
  const auto = useId();
  const base = idPrefix ?? auto;
  const match = HM.exec(value);
  const hour = match?.[1] ?? '';
  const minute = match?.[2] ?? '';
  // A minute that is not on the 5-minute grid (an old value, an imported one) stays selectable.
  const minutes = minute && !MINUTES.includes(minute) ? [...MINUTES, minute].sort() : MINUTES;
  const border = borderFor(invalid ? 'x' : undefined);
  const midnight = endOfDay && hour === '24';
  const baseHours = endOfDay ? [...HOURS.slice(1), '24'] : HOURS;
  // A value outside the list (an imported 00:30 end) stays selectable instead of silently changing.
  const hours = hour && !baseHours.includes(hour) ? [hour, ...baseHours].sort() : baseHours;
  return (
    <div dir="ltr" className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1">
        <select
          id={`${base}-h`}
          aria-label={t('hours', { label })}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          value={hour}
          onChange={(e) =>
            onChange(e.target.value === '24' ? '24:00' : `${e.target.value}:${minute || '00'}`)
          }
          className={cn(selectClass, border, 'w-full')}
        >
          {hour ? null : <option value="">--</option>}
          {hours.map((h) => (
            <option key={h} value={h}>
              {h === '24' ? t('midnight') : h}
            </option>
          ))}
        </select>
      </div>
      <span aria-hidden="true" className="text-base font-semibold text-muted">
        :
      </span>
      <div className="min-w-0 flex-1">
        <select
          id={`${base}-m`}
          aria-label={t('minutes', { label })}
          aria-invalid={invalid || undefined}
          disabled={disabled || midnight}
          value={midnight ? '00' : minute}
          onChange={(e) => onChange(`${hour || '00'}:${e.target.value}`)}
          className={cn(selectClass, border, 'w-full')}
        >
          {minute ? null : <option value="">--</option>}
          {(midnight ? ['00'] : minutes).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** A labelled 24-hour time-of-day field (opening hours): `value` is `HH:mm`. */
export function TimeField({
  label,
  value,
  onChange,
  invalid,
  disabled,
  className,
  endOfDay,
}: {
  label: string;
  value: string;
  onChange: (hm: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  endOfDay?: boolean;
}) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className={cn('flex flex-col gap-1.5', className)}>
      <span id={labelId} className="text-sm font-medium">
        {label}
      </span>
      <TimeSelects
        label={label}
        value={value}
        onChange={onChange}
        invalid={invalid}
        disabled={disabled}
        endOfDay={endOfDay}
      />
    </div>
  );
}

/**
 * A date plus a 24-hour time (replaces `datetime-local`). The parent holds `date` (`yyyy-MM-dd`, may be empty) and
 * `time` (`HH:mm`) separately, so a time picked before the date is not lost.
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
}) {
  const t = useTranslations('ui.fields');
  const id = useId();
  const labelId = `${id}-label`;
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1.5">
      <span id={labelId} className="text-sm font-medium">
        {label}
      </span>
      <DateInput
        id={`${id}-date`}
        name={name}
        value={date}
        onChange={onDateChange}
        disabled={disabled}
        error={error}
        hint={hint}
        dir="ltr"
        aria-label={t('date', { label })}
      />
      <DatePreview id={`${id}-date-day`} ymd={date} />
      <TimeSelects
        label={label}
        value={time}
        onChange={onTimeChange}
        invalid={Boolean(error)}
        disabled={disabled}
        idPrefix={`${id}-time`}
      />
      {hint && !error ? (
        <p id={`${id}-date-hint`} className="m-0 text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-date-error`} role="alert" className="m-0 text-[13px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
