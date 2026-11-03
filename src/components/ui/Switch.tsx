import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type SwitchProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'role' | 'aria-checked' | 'onChange' | 'aria-label'
> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Accessible name, for example "Haircut active". */
  label: string;
  /** Show a pending state while the change is saved. */
  pending?: boolean;
};

/**
 * 52 x 32 toggle (board 3.5). The visible track is 32 px; the button itself is 44 px tall.
 * The knob uses flex alignment, so it mirrors in RTL without extra classes.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  pending,
  className,
  disabled,
  ...props
}: SwitchProps) {
  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={pending || undefined}
      disabled={disabled}
      onClick={() => (pending ? undefined : onCheckedChange(!checked))}
      className={cn(
        // The button is the 44 px tap target; the visible 52 x 32 track is the inner span.
        'flex h-11 w-[52px] shrink-0 items-center border-0 bg-transparent p-0',
        pending && 'opacity-70',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex h-8 w-full items-center rounded-pill p-[3px] transition-colors duration-200 ease-out',
          checked ? 'justify-end bg-brand' : 'justify-start bg-subtle',
        )}
      >
        <span className="size-[26px] rounded-pill bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.2)]" />
      </span>
    </button>
  );
}
