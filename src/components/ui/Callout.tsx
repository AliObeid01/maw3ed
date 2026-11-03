import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type CalloutProps = {
  icon?: ReactNode;
  tone?: 'brand' | 'warning' | 'danger';
  children: ReactNode;
  className?: string;
};

const tones = {
  brand: 'bg-brand-soft text-brand-deep',
  warning: 'border border-warning-line bg-warning-soft text-warning-deep',
  danger: 'border border-danger-line bg-danger-soft text-danger',
} as const;

/** Info callout (radius 20, padding 16). The icon is decorative. */
export function Callout({ icon, tone = 'brand', children, className }: CalloutProps) {
  return (
    <div className={cn('flex items-start gap-2.5 rounded-card-sm p-4', tones[tone], className)}>
      {icon ? (
        <span aria-hidden="true" className="flex shrink-0 [&>svg]:size-5">
          {icon}
        </span>
      ) : null}
      <div className="text-sm leading-[1.45]">{children}</div>
    </div>
  );
}
