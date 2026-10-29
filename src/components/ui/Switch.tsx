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
 * 52 x 32 toggle (board 3.5). The visible track is 32 px; the invisible hit area reaches 44 px.
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
        'relative flex h-8 w-[52px] shrink-0 items-center rounded-pill border-0 p-[3px] transition-colors duration-200 ease-out',
        'before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[""]',
        checked ? 'justify-end bg-accent' : 'justify-start bg-[#d2ccbe]',
        pending && 'opacity-70',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="size-[26px] rounded-pill bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.2)]"
      />
    </button>
  );
}
