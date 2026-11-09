import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'whatsapp' | 'call' | 'navy' | 'turquoise' | 'onDark';
export type ButtonSize = 'md' | 'row' | 'lg' | 'hero';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover',
  accent: 'bg-electric text-white hover:bg-brand-hover',
  secondary: 'border border-line bg-surface text-ink hover:bg-canvas',
  ghost: 'bg-transparent text-brand hover:bg-brand-soft',
  // WhatsApp is solid deep green (never the bright WhatsApp brand green, it fails contrast with white); Call is OUTLINED Royal Blue.
  whatsapp: 'bg-whatsapp text-white hover:bg-whatsapp-hover active:bg-whatsapp-hover',
  call: 'border border-brand bg-surface text-brand hover:bg-brand-soft active:bg-brand-soft',
  // Marketplace home (the owner's design): navy and turquoise carry NAVY text; onDark is the outline button on the navy band.
  navy: 'bg-navy text-white hover:bg-navy-hover',
  turquoise: 'bg-turquoise text-ink hover:bg-turquoise-hover',
  onDark: 'border-[1.5px] border-white/55 bg-transparent text-white hover:bg-white/10',
  danger: 'border border-danger-line bg-danger-soft text-danger hover:brightness-95',
};

// 44 default, 46 for row actions, 50 for the main call to action.
const sizes: Record<ButtonSize, string> = {
  md: 'h-11 px-[18px] text-[15px]',
  row: 'h-[46px] px-5 text-[15px]',
  lg: 'h-[50px] px-6 text-[15px]',
  // The home page's 14 px-radius buttons (48 px).
  hero: 'h-12 rounded-btn-lg px-[22px] text-base',
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
    'motion-press inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-btn font-semibold whitespace-nowrap no-underline transition-colors duration-200 ease-out',
    'disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
    variants[variant],
    sizes[size],
    block && 'w-full',
    className,
  );
}
