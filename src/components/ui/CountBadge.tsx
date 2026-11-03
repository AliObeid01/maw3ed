import { cn } from '@/lib/cn';
import { capCount } from '@/lib/dashboard/agenda';

export type CountBadgeProps = {
  count: number;
  /** `danger` = reminders due (red), `warning` = outcomes to mark (amber). */
  tone?: 'danger' | 'warning';
  /** Screen-reader text, e.g. "4 reminders due". The visible number is hidden from AT. */
  label?: string;
  className?: string;
};

export function CountBadge({ count, tone = 'danger', label, className }: CountBadgeProps) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-btn px-1.5 text-xs leading-none font-bold tabular-nums',
        tone === 'danger' ? 'bg-danger text-white' : 'bg-warning-soft text-warning',
        className,
      )}
    >
      <span dir="ltr" aria-hidden={label ? true : undefined}>
        {capCount(count)}
      </span>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
