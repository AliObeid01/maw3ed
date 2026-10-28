import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'accent' | 'secondary';
type Size = 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover',
  accent: 'bg-accent text-ink hover:brightness-95',
  secondary: 'border border-line bg-surface text-ink hover:bg-canvas',
};

const sizes: Record<Size, string> = {
  md: 'min-h-11 px-5',
  lg: 'min-h-[50px] px-6',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-pill font-semibold transition-colors duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}
