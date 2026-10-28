import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

const control =
  'h-[52px] w-full rounded-input border bg-surface px-3.5 text-base text-ink placeholder:text-subtle transition-colors duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-60';

function borderFor(error?: string) {
  return error ? 'border-danger' : 'border-line';
}

type FieldShellProps = {
  id: string;
  label: ReactNode;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
};

function FieldShell({ id, label, error, hint, className, children }: FieldShellProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[13px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Our error/hint ids first, then any ids the caller already supplied (never dropped). */
export function describedByIds(
  id: string,
  error: string | undefined,
  hint: string | undefined,
  extra: string | undefined,
) {
  const ids = [error ? `${id}-error` : hint ? `${id}-hint` : undefined, extra]
    .filter(Boolean)
    .join(' ');
  return ids || undefined;
}

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  id?: string;
  label: ReactNode;
  error?: string;
  hint?: string;
  /** Wrapper class; use `className` for the input itself. */
  wrapperClassName?: string;
};

/** Always pass `autoComplete` and, for numeric fields, `inputMode` (e.g. type="tel" + autoComplete="tel"). */
export function Input({
  id,
  label,
  error,
  hint,
  className,
  wrapperClassName,
  'aria-describedby': extraDescribedBy,
  ...props
}: InputProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  const ltrData = props.type === 'tel' || props.type === 'email' || props.type === 'url';
  return (
    <FieldShell id={fieldId} label={label} error={error} hint={hint} className={wrapperClassName}>
      <input
        {...props}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedByIds(fieldId, error, hint, extraDescribedBy)}
        // Phones, emails and URLs are LTR data even inside Arabic UI (keeps "+961" and "@" in order).
        dir={props.dir ?? (ltrData ? 'ltr' : undefined)}
        className={cn(control, borderFor(error), className)}
      />
    </FieldShell>
  );
}

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
  id?: string;
  label: ReactNode;
  error?: string;
  hint?: string;
  wrapperClassName?: string;
};

export function Select({
  id,
  label,
  error,
  hint,
  className,
  wrapperClassName,
  children,
  'aria-describedby': extraDescribedBy,
  ...props
}: SelectProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldShell id={fieldId} label={label} error={error} hint={hint} className={wrapperClassName}>
      <div className="relative">
        <select
          {...props}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedByIds(fieldId, error, hint, extraDescribedBy)}
          className={cn(control, borderFor(error), 'appearance-none pe-10', className)}
        >
          {children}
        </select>
        <ChevronDown
          size={18}
          aria-hidden="true"
          className="pointer-events-none absolute end-3.5 top-1/2 -translate-y-1/2 text-muted"
        />
      </div>
    </FieldShell>
  );
}
