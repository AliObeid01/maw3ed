import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type CardProps = HTMLAttributes<HTMLElement> & {
  /** `lg` = 24 px radius (main cards), `sm` = 22 px radius (side cards). */
  size?: 'lg' | 'sm';
  as?: 'div' | 'section' | 'article' | 'aside' | 'li';
  /** Padding preset: 24 px on desktop by default, 20 px on phones; `compact` = 18 px. */
  padding?: 'default' | 'compact' | 'none';
};

export function Card({
  as: Tag = 'div',
  size = 'lg',
  padding = 'default',
  className,
  ...props
}: CardProps) {
  return (
    <Tag
      className={cn(
        'border border-line bg-surface',
        size === 'lg' ? 'rounded-card' : 'rounded-card-sm',
        padding === 'default' && 'p-5 md:p-6',
        padding === 'compact' && 'p-[18px]',
        className,
      )}
      {...props}
    />
  );
}
