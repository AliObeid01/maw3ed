'use client';

import { Check, Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { cn } from '@/lib/cn';
import {
  displayHm,
  hourOptions,
  minuteOptions,
  parseHm,
  withHour,
  withMinute,
} from '@/lib/pickers/timeOptions';
import { typeaheadIndex } from '@/lib/pickers/typeahead';
import { describedByIds, FieldShell } from './Field';
import { PickerSurface } from './pickers/PickerSurface';
import { PickerTrigger } from './pickers/PickerTrigger';
import { revealInside } from './pickers/scroll';

const EMPTY_TIME = '--:--';

export type TimePickerControlProps = {
  id: string;
  value: string;
  onChange: (hm: string) => void;
  /** Accessible name of the field (the visible label, or "<label>, time" inside a date-time group). */
  label: string;
  name?: string;
  invalid?: boolean;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  /**
   * A closing time: hours run 01-24 and `24` is end of day ("24:00 (midnight)", minutes locked to 00), so nobody
   * needs the old 00:00-means-24:00 trick. 00 is not offered because it would be ambiguous with 24.
   */
  endOfDay?: boolean;
  describedBy?: string;
  className?: string;
  /** Labelled by an element elsewhere (a group heading) instead of by `label`. */
  labelledBy?: string;
};

/**
 * One field showing `HH:mm` (24 hours, Latin digits, always left to right). It opens a bottom sheet on phones and a
 * popover from `md`, with an hours column and a minutes column (5-minute grid). `value` and `onChange` are `HH:mm`.
 */
export function TimePickerControl({
  id,
  value,
  onChange,
  label,
  name,
  invalid,
  error,
  disabled,
  required,
  endOfDay,
  describedBy,
  className,
  labelledBy,
}: TimePickerControlProps) {
  const t = useTranslations('ui.pickers');
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = `${id}-panel`;
  const shown = displayHm(value);
  return (
    <>
      <PickerTrigger
        ref={triggerRef}
        id={id}
        name={name}
        data-value={value}
        text={shown}
        placeholder={EMPTY_TIME}
        icon={<Clock size={18} />}
        expanded={open}
        popup="dialog"
        controlsId={panelId}
        invalid={invalid || Boolean(error)}
        textDir="ltr"
        required={required}
        disabled={disabled}
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
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
        width={232}
      >
        <TimePanel
          id={panelId}
          value={value}
          endOfDay={endOfDay}
          onPick={(hm, done) => {
            onChange(hm);
            if (done) setOpen(false);
          }}
        />
      </PickerSurface>
    </>
  );
}

/** A labelled time-of-day field (opening hours): `value` is `HH:mm`. */
export function TimePicker({
  label,
  value,
  onChange,
  name,
  error,
  hint,
  invalid,
  disabled,
  required,
  endOfDay,
  id,
  className,
  wrapperClassName,
}: {
  label: ReactNode;
  value: string;
  onChange: (hm: string) => void;
  name?: string;
  error?: string;
  hint?: string;
  invalid?: boolean;
  disabled?: boolean;
  required?: boolean;
  endOfDay?: boolean;
  id?: string;
  className?: string;
  wrapperClassName?: string;
}) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldShell id={fieldId} label={label} error={error} hint={hint} className={wrapperClassName}>
      <TimePickerControl
        id={fieldId}
        label={typeof label === 'string' ? label : ''}
        labelledBy={undefined}
        value={value}
        onChange={onChange}
        name={name}
        invalid={invalid}
        error={error}
        disabled={disabled}
        required={required}
        endOfDay={endOfDay}
        describedBy={describedByIds(fieldId, error, hint, undefined)}
        className={className}
      />
    </FieldShell>
  );
}

type Column = 'hours' | 'minutes';

function TimePanel({
  id,
  value,
  endOfDay,
  onPick,
}: {
  id: string;
  value: string;
  endOfDay?: boolean;
  onPick: (hm: string, done: boolean) => void;
}) {
  const parsed = parseHm(value);
  const hour = parsed?.hour ?? '';
  const minute = parsed?.minute ?? '';
  const hours = hourOptions(hour, endOfDay);
  const minutes = minuteOptions(minute, hour, endOfDay);
  const [activeH, setActiveH] = useState(() => Math.max(hours.indexOf(hour), hours.indexOf('09'), 0));
  const [activeM, setActiveM] = useState(() => Math.max(minutes.indexOf(minute), 0));
  const hoursRef = useRef<HTMLDivElement>(null);
  const minutesRef = useRef<HTMLDivElement>(null);
  const buffer = useRef({ text: '', timer: 0 });

  useEffect(() => {
    hoursRef.current?.focus({ preventScroll: true });
    const typed = buffer.current;
    return () => window.clearTimeout(typed.timer);
  }, []);

  const first = useRef(true);
  useEffect(() => {
    for (const [ref, index] of [
      [hoursRef, activeH],
      [minutesRef, activeM],
    ] as const) {
      const list = ref.current;
      const el = list?.querySelector<HTMLElement>(`[data-index="${index}"]`);
      if (list && el) revealInside(list, el, first.current);
    }
    first.current = false;
  }, [activeH, activeM]);

  const chooseHour = (index: number) => {
    const h = hours[index]!;
    const next = withHour(h, minute, endOfDay);
    const locked = Boolean(endOfDay) && h === '24';
    onPick(next, locked);
    if (!locked) {
      // The minutes list may have changed (24 -> back to a normal hour): point at the current minute.
      const list = minuteOptions(minute, h, endOfDay);
      setActiveM(Math.max(list.indexOf(minute), 0));
      minutesRef.current?.focus({ preventScroll: true });
    }
  };
  const chooseMinute = (index: number) => onPick(withMinute(hour, minutes[index]!), true);

  const handleKey = (column: Column, e: KeyboardEvent<HTMLDivElement>) => {
    const list = column === 'hours' ? hours : minutes;
    const active = column === 'hours' ? activeH : activeM;
    const setActive = column === 'hours' ? setActiveH : setActiveM;
    const move = (to: number) => setActive(Math.min(Math.max(to, 0), list.length - 1));
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        return move(active + 1);
      case 'ArrowUp':
        e.preventDefault();
        return move(active - 1);
      case 'PageDown':
        e.preventDefault();
        return move(active + 6);
      case 'PageUp':
        e.preventDefault();
        return move(active - 6);
      case 'Home':
        e.preventDefault();
        return move(0);
      case 'End':
        e.preventDefault();
        return move(list.length - 1);
      // The panel is always drawn left to right (hours, then minutes), so the arrows follow the screen.
      case 'ArrowRight':
        e.preventDefault();
        return column === 'hours' ? minutesRef.current?.focus() : undefined;
      case 'ArrowLeft':
        e.preventDefault();
        return column === 'minutes' ? hoursRef.current?.focus() : undefined;
      case 'Enter':
      case ' ':
        e.preventDefault();
        return column === 'hours' ? chooseHour(active) : chooseMinute(active);
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      window.clearTimeout(buffer.current.timer);
      buffer.current.text += e.key;
      buffer.current.timer = window.setTimeout(() => (buffer.current.text = ''), 700);
      const hit = typeaheadIndex(
        list.map((label) => ({ label })),
        buffer.current.text,
        -1,
      );
      if (hit >= 0) setActive(hit);
    }
  };

  return (
    <div id={id} dir="ltr" className="flex min-h-0 gap-2">
      <TimeColumn
        id={id}
        column="hours"
        listRef={hoursRef}
        list={hours}
        active={activeH}
        selected={hour}
        endOfDay={endOfDay}
        onKeyDown={(e) => handleKey('hours', e)}
        onChoose={chooseHour}
      />
      <TimeColumn
        id={id}
        column="minutes"
        listRef={minutesRef}
        list={minutes}
        active={activeM}
        selected={endOfDay && hour === '24' ? '00' : minute}
        endOfDay={endOfDay}
        onKeyDown={(e) => handleKey('minutes', e)}
        onChoose={chooseMinute}
      />
    </div>
  );
}

function TimeColumn({
  id,
  column,
  listRef,
  list,
  active,
  selected,
  endOfDay,
  onKeyDown,
  onChoose,
}: {
  id: string;
  column: Column;
  listRef: RefObject<HTMLDivElement | null>;
  list: string[];
  active: number;
  selected: string;
  endOfDay?: boolean;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  onChoose: (index: number) => void;
}) {
  const t = useTranslations('ui.pickers');
  const colId = `${id}-${column}`;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="px-2 text-xs font-semibold text-muted">{t(column)}</span>
      <div
        ref={listRef}
        id={colId}
        role="listbox"
        data-picker-host={column === "hours" ? "" : undefined}
        tabIndex={0}
        aria-label={t(column)}
        aria-activedescendant={`${colId}-${active}`}
        onKeyDown={onKeyDown}
        className="relative h-[264px] overflow-y-auto overscroll-contain rounded-btn outline-none focus-visible:ring-2 focus-visible:ring-electric focus-visible:ring-inset"
      >
        {list.map((v, index) => (
          <div
            key={v}
            id={`${colId}-${index}`}
            role="option"
            aria-selected={v === selected}
            data-index={index}
            data-active={index === active || undefined}
            onClick={() => onChoose(index)}
            className={cn(
              'relative flex min-h-11 cursor-pointer flex-wrap items-center justify-center gap-x-1.5 rounded-btn px-7 py-1 text-base tabular-nums transition-colors duration-150 ease-out hover:bg-canvas',
              'data-active:bg-brand-soft',
              v === selected && 'bg-brand font-semibold text-white hover:bg-brand-hover data-active:bg-brand',
            )}
          >
            {v}
            {column === 'hours' && v === '24' && endOfDay ? (
              <span className="text-xs font-medium opacity-80">{t('midnightTag')}</span>
            ) : null}
            {v === selected ? (
              <Check size={14} aria-hidden="true" className="absolute end-2.5 top-1/2 -translate-y-1/2" />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
