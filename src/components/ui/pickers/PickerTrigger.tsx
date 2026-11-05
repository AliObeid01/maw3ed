'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { borderFor, control } from '../Field';

export type PickerTriggerProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'role' | 'type'> & {
  /** The chosen value as text; empty shows the placeholder. */
  text: string;
  placeholder: string;
  icon: ReactNode;
  expanded: boolean;
  popup: 'listbox' | 'dialog';
  controlsId?: string;
  invalid?: boolean;
  /** Force the value text direction (times, time zones, dial codes are always left to right). */
  textDir?: 'ltr' | 'rtl';
  required?: boolean;
};

/**
 * The closed state of every picker: a 52 px field-looking button with the value and an icon. It is the
 * WAI-ARIA select-only combobox (role combobox, aria-expanded, aria-haspopup), named by the visible label.
 */
export const PickerTrigger = forwardRef<HTMLButtonElement, PickerTriggerProps>(function PickerTrigger(
  { text, placeholder, icon, expanded, popup, controlsId, invalid, textDir, required, className, ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type="button"
      role="combobox"
      aria-haspopup={popup}
      aria-expanded={expanded}
      aria-controls={expanded ? controlsId : undefined}
      aria-invalid={invalid || undefined}
      aria-required={required || undefined}
      className={cn(
        control,
        borderFor(invalid ? 'x' : undefined),
        'flex min-w-0 cursor-pointer items-center justify-between gap-2 text-start',
        'aria-expanded:border-brand',
        className,
      )}
    >
      <span
        dir={textDir}
        className={cn('min-w-0 flex-1 truncate text-start', text ? 'text-ink' : 'text-subtle', textDir === 'ltr' && 'tabular-nums')}
      >
        {text || placeholder}
      </span>
      <span aria-hidden="true" className="shrink-0 text-muted">
        {icon}
      </span>
    </button>
  );
});
