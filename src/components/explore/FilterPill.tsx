import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** A toggle pill (the design's `.sg`): 44 px tall, outline when off, solid Royal Blue when on. */
export function FilterPill({
  pressed,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        'inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-pill border-[1.5px] px-4 text-[15px] transition-colors duration-200 ease-out motion-reduce:transition-none',
        pressed
          ? 'border-brand bg-brand font-semibold text-white'
          : 'border-brand-avatar bg-surface font-medium text-ink hover:border-electric',
        className,
      )}
      {...props}
    />
  );
}
