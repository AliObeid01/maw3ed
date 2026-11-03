'use client';

import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { radioGroupKeyDown } from './radioKeys';

export type SegmentedOption<T extends string | number> = { value: T; label: ReactNode };

/** Radio group styled as the board 3.8 "Time slots every" control (44 px segments). */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-[15px] font-medium">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        onKeyDown={(e) => radioGroupKeyDown(e, (i) => onChange(options[i]!.value))}
        className="grid gap-1 rounded-2xl bg-canvas p-1"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                'h-11 rounded-nav border-0 text-[15px] transition-colors duration-200 ease-out disabled:opacity-60',
                checked
                  ? 'bg-surface font-semibold text-ink shadow-[0_2px_6px_rgb(11_25_56/0.1)]'
                  : 'bg-transparent text-muted hover:text-ink',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
