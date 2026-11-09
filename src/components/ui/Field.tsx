import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const control =
  'h-[52px] w-full rounded-input border bg-surface px-3.5 text-base text-ink placeholder:text-subtle transition-colors duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-60';

/**
 * For a forced-LTR numeric input (card number, expiry, CVC, phone): the digits stay left-to-right (dir="ltr"), but the
 * text sits at the END edge of the PAGE so it lines up under its label (right in Arabic, left in English). A physical
 * `text-right` is needed because the input itself is dir="ltr", so `text-end` would resolve to the left; `rtl:` reads the
 * page direction from an ancestor.
 */
export const ltrNumericEnd = 'rtl:text-right';

export function borderFor(error?: string) {
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

/** Label above, control, then hint or error below. Exported for composite controls (slug, password). */
export function FieldShell({ id, label, error, hint, className, children }: FieldShellProps) {
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
  /** Control rendered inside the input at the end edge (for example a show/hide password button, 44 px max). */
  endAdornment?: ReactNode;
};

/** Always pass `autoComplete` and, for numeric fields, `inputMode` (e.g. type="tel" + autoComplete="tel"). */
export function Input({
  id,
  label,
  error,
  hint,
  className,
  wrapperClassName,
  endAdornment,
  'aria-describedby': extraDescribedBy,
  ...props
}: InputProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  const ltrData = props.type === 'tel' || props.type === 'email' || props.type === 'url';
  // Phones, emails and URLs are LTR data even inside Arabic UI (keeps "+961" and "@" in order).
  const dir = props.dir ?? (ltrData ? 'ltr' : undefined);
  const input = (
    <input
      {...props}
      id={fieldId}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedByIds(fieldId, error, hint, extraDescribedBy)}
      dir={dir}
      className={cn(control, borderFor(error), endAdornment && 'pe-14', className)}
    />
  );
  return (
    <FieldShell id={fieldId} label={label} error={error} hint={hint} className={wrapperClassName}>
      {endAdornment ? (
        // The wrapper shares the input's direction so "end" is the same edge for both.
        <div className="relative" dir={dir}>
          {input}
          <div className="absolute end-1 top-1/2 -translate-y-1/2">{endAdornment}</div>
        </div>
      ) : (
        input
      )}
    </FieldShell>
  );
}
