'use client';

import { Check, ChevronDown, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';
import { filterOptions, typeaheadIndex } from '@/lib/pickers/typeahead';
import { borderFor, control, describedByIds, FieldShell } from './Field';
import { PickerSurface, useSurfaceMode } from './pickers/PickerSurface';
import { PickerTrigger } from './pickers/PickerTrigger';
import { revealInside } from './pickers/scroll';

export type SelectOption = {
  value: string;
  label: string;
  /** Extra text the search box also matches (for example the IANA zone behind a friendly name). */
  searchText?: string;
  disabled?: boolean;
  /** Text in the closed field when the full label is too long for it (a dial code instead of "+961 Lebanon"). */
  shortLabel?: string;
  /** Heading shown above the first option of each group; keep the options of one group together. */
  group?: string;
};

export type SelectProps = {
  id?: string;
  label: ReactNode;
  /** Sheet heading when `label` is not plain text. */
  title?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Shown while `value` matches no option (for example "Choose a service"). */
  placeholder?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  required?: boolean;
  /** A search box above the options, for long lists (time zones, country codes). */
  searchable?: boolean;
  /** Force left to right for values that are always Latin (time zones, dial codes). */
  dir?: 'ltr' | 'rtl';
  className?: string;
  wrapperClassName?: string;
  'aria-describedby'?: string;
  'aria-disabled'?: boolean;
  /** No label, hint or error around the field (it sits inside a composite control); `label` becomes its accessible name. */
  bare?: boolean;
  /** Width of the popover in px (defaults to the field's width). */
  menuWidth?: number;
};

/**
 * A styled listbox in place of the browser's `<select>`: a field-looking button that opens a bottom sheet on phones and
 * an anchored popover from `md`. WAI-ARIA select-only combobox: arrows, Home/End, typeahead, Enter/Space, Esc, focus
 * return, `aria-expanded`, a check mark on the chosen option. `onChange` receives the option's string value.
 */
export function Select({
  id,
  label,
  title,
  name,
  value,
  onChange,
  options,
  placeholder,
  error,
  hint,
  disabled,
  required,
  searchable,
  dir,
  className,
  wrapperClassName,
  menuWidth,
  bare,
  'aria-describedby': extraDescribedBy,
  'aria-disabled': ariaDisabled,
}: SelectProps) {
  const t = useTranslations('ui.pickers');
  const auto = useId();
  const fieldId = id ?? auto;
  const listId = `${fieldId}-list`;
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);
  const sheetTitle = title ?? (typeof label === 'string' ? label : (placeholder ?? t('select')));

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || ariaDisabled || open) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setSeed('');
      setOpen(true);
    } else if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setSeed(e.key);
      setOpen(true);
    }
  };

  const body = (
    <>
      <PickerTrigger
        ref={triggerRef}
        id={fieldId}
        name={name}
        data-value={value}
        text={current ? (current.shortLabel ?? current.label) : ''}
        placeholder={placeholder ?? t('select')}
        icon={<ChevronDown size={18} />}
        expanded={open}
        popup="listbox"
        controlsId={listId}
        invalid={Boolean(error)}
        textDir={dir}
        required={required}
        disabled={disabled}
        aria-disabled={ariaDisabled}
        aria-label={bare && typeof label === 'string' ? label : undefined}
        aria-describedby={describedByIds(fieldId, error, hint, extraDescribedBy)}
        className={className}
        onClick={() => {
          if (disabled || ariaDisabled) return;
          setSeed('');
          setOpen((o) => !o);
        }}
        onKeyDown={onTriggerKeyDown}
      />
      <PickerSurface
        open={open}
        onOpenChange={setOpen}
        anchorRef={triggerRef}
        title={sheetTitle}
        closeLabel={t('close')}
        width={menuWidth ?? 'anchor'}
      >
        <OptionList
          listId={listId}
          label={sheetTitle}
          options={options}
          value={value}
          searchable={searchable}
          seed={seed}
          dir={dir}
          onSelect={(v) => {
            setOpen(false);
            if (v !== value) onChange(v);
          }}
        />
      </PickerSurface>
    </>
  );
  if (bare) return body;
  return (
    <FieldShell id={fieldId} label={label} error={error} hint={hint} className={wrapperClassName}>
      {body}
    </FieldShell>
  );
}

const TYPEAHEAD_RESET_MS = 700;

function firstEnabled(list: SelectOption[], from: number, step: 1 | -1): number {
  for (let i = from; i >= 0 && i < list.length; i += step) if (!list[i]!.disabled) return i;
  return -1;
}

function OptionList({
  listId,
  label,
  options,
  value,
  searchable,
  seed,
  dir,
  onSelect,
}: {
  listId: string;
  label: string;
  options: SelectOption[];
  value: string;
  searchable?: boolean;
  seed: string;
  dir?: 'ltr' | 'rtl';
  onSelect: (value: string) => void;
}) {
  const t = useTranslations('ui.pickers');
  const mode = useSurfaceMode();
  const [query, setQuery] = useState(searchable ? seed : '');
  const visible = useMemo(
    () => (searchable ? filterOptions(options, query) : options),
    [options, query, searchable],
  );
  const [active, setActive] = useState(() => {
    if (seed && !searchable) {
      const hit = typeaheadIndex(options, seed, options.findIndex((o) => o.value === value));
      if (hit >= 0) return hit;
    }
    const selected = options.findIndex((o) => o.value === value && !o.disabled);
    return selected >= 0 ? selected : firstEnabled(options, 0, 1);
  });
  const hostRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const buffer = useRef({ text: '', timer: 0 });

  useEffect(() => {
    hostRef.current?.focus({ preventScroll: true });
    const typed = buffer.current;
    return () => window.clearTimeout(typed.timer);
  }, []);

  // Reveal the active option; centre the chosen one when the list opens.
  const first = useRef(true);
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (list && el) revealInside(list, el, first.current);
    first.current = false;
  }, [active]);

  // In a popover the list only gets its capped height once the surface has been placed (just after mount), and an
  // un-capped list cannot scroll: centre the chosen option again on the next frame. A separate effect with no
  // dependencies, so it also survives React's development double-invoke of mount effects.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const list = listRef.current;
      const el = list?.querySelector<HTMLElement>('[aria-selected="true"]');
      if (list && el) revealInside(list, el, true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const choose = (index: number) => {
    const o = visible[index];
    if (o && !o.disabled) onSelect(o.value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const stop = () => e.preventDefault();
    switch (e.key) {
      case 'ArrowDown': {
        stop();
        const n = firstEnabled(visible, active + 1, 1);
        if (n >= 0) setActive(n);
        else if (active < 0) setActive(firstEnabled(visible, 0, 1));
        return;
      }
      case 'ArrowUp': {
        stop();
        const n = firstEnabled(visible, active - 1, -1);
        if (n >= 0) setActive(n);
        return;
      }
      case 'PageDown': {
        stop();
        const n = firstEnabled(visible, Math.min(active + 8, visible.length - 1), -1);
        if (n >= 0) setActive(n);
        return;
      }
      case 'PageUp': {
        stop();
        const n = firstEnabled(visible, Math.max(active - 8, 0), 1);
        if (n >= 0) setActive(n);
        return;
      }
      case 'Home':
      case 'End': {
        if (searchable) return;
        stop();
        const n =
          e.key === 'Home' ? firstEnabled(visible, 0, 1) : firstEnabled(visible, visible.length - 1, -1);
        if (n >= 0) setActive(n);
        return;
      }
      case 'Enter':
        stop();
        choose(active);
        return;
      case ' ':
        if (searchable) return;
        stop();
        choose(active);
        return;
    }
    if (!searchable && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      stop();
      window.clearTimeout(buffer.current.timer);
      buffer.current.text += e.key;
      buffer.current.timer = window.setTimeout(() => (buffer.current.text = ''), TYPEAHEAD_RESET_MS);
      const hit = typeaheadIndex(visible, buffer.current.text, active);
      if (hit >= 0) setActive(hit);
    }
  };

  const groups = useMemo(() => {
    const out: { heading?: string; items: { o: SelectOption; index: number }[] }[] = [];
    visible.forEach((o, index) => {
      const last = out.at(-1);
      if (last && last.heading === o.group) last.items.push({ o, index });
      else out.push({ heading: o.group, items: [{ o, index }] });
    });
    return out;
  }, [visible]);

  const activeId = active >= 0 && visible[active] ? `${listId}-opt-${active}` : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {searchable ? (
        <div className="relative shrink-0">
          <Search
            size={18}
            aria-hidden="true"
            className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            ref={(el) => {
              hostRef.current = el;
            }}
            type="text"
            role="combobox"
            data-picker-host=""
            aria-label={t('search')}
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            placeholder={t('searchPlaceholder')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              const next = filterOptions(options, e.target.value);
              setActive(firstEnabled(next, 0, 1));
            }}
            onKeyDown={onKeyDown}
            className={cn(control, borderFor(), 'h-11 ps-10')}
          />
        </div>
      ) : null}
      <div
        id={listId}
        ref={(el) => {
          listRef.current = el;
          if (!searchable) hostRef.current = el;
        }}
        role="listbox"
        data-picker-host={searchable ? undefined : ""}
        aria-label={label}
        tabIndex={searchable ? undefined : -1}
        aria-activedescendant={searchable ? undefined : activeId}
        onKeyDown={searchable ? undefined : onKeyDown}
        className={cn(
          'relative min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none',
          mode === 'sheet' && 'max-h-[min(60dvh,26rem)]',
        )}
      >
        {visible.length === 0 ? (
          <p role="status" className="m-0 px-3 py-6 text-center text-sm text-muted">
            {t('noResults')}
          </p>
        ) : (
          groups.map((g, gi) => (
            <div
              key={g.heading ?? `g${gi}`}
              role={g.heading ? 'group' : 'presentation'}
              aria-labelledby={g.heading ? `${listId}-g${gi}` : undefined}
            >
              {g.heading ? (
                <div
                  id={`${listId}-g${gi}`}
                  role="presentation"
                  className="px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted"
                >
                  {g.heading}
                </div>
              ) : null}
              {g.items.map(({ o, index }) => {
                const selected = o.value === value;
                return (
                  <div
                    key={o.value}
                    id={`${listId}-opt-${index}`}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={o.disabled || undefined}
                    data-index={index}
                    data-active={index === active || undefined}
                    dir={dir}
                    onClick={() => choose(index)}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-btn px-3 py-2 text-base transition-colors duration-150 ease-out hover:bg-canvas',
                      'data-active:bg-brand-soft data-active:ring-2 data-active:ring-electric data-active:ring-inset',
                      selected && 'font-semibold',
                      o.disabled && 'cursor-not-allowed text-subtle hover:bg-transparent',
                    )}
                  >
                    <span className="min-w-0 flex-1 break-words">{o.label}</span>
                    {selected ? (
                      <Check size={18} aria-hidden="true" className="shrink-0 text-brand" />
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
