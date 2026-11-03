import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  /** Accessible name (required: the button has no visible text). */
  label: string;
};

/** 44 px circle for back / previous / next. Pass directional icons with `rtl:-scale-x-100`. */
export function IconButton({
  label,
  className,
  type = 'button',
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cn(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-btn border border-line bg-surface text-ink transition-colors duration-200 ease-out hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
