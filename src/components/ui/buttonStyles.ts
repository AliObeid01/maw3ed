import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'row' | 'lg';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover',
  accent: 'bg-electric text-white hover:bg-brand-hover',
  secondary: 'border border-line bg-surface text-ink hover:bg-canvas',
  ghost: 'bg-transparent text-brand hover:bg-brand-soft',
  danger: 'border border-danger-line bg-danger-soft text-danger hover:brightness-95',
};

// 44 default, 46 for row actions, 50 for the main call to action.
const sizes: Record<ButtonSize, string> = {
  md: 'h-11 px-[18px] text-[15px]',
  row: 'h-[46px] px-5 text-[15px]',
  lg: 'h-[50px] px-6 text-[15px]',
};

/** Class string for anything that should look like a Button (server-safe, no handlers). */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  block = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
} = {}) {
  return cn(
    'inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-btn font-semibold whitespace-nowrap no-underline transition-colors duration-200 ease-out',
    'disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
    variants[variant],
    sizes[size],
    block && 'w-full',
    className,
  );
}
