import type { HTMLAttributes } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

export type ChipTone =
  'neutral' | 'muted' | 'brand' | 'info' | 'refill' | 'success' | 'danger' | 'warning' | 'amber' | 'outline';

const tones: Record<ChipTone, string> = {
  neutral: 'bg-divider text-muted',
  muted: 'bg-divider text-muted line-through',
  brand: 'bg-brand-soft text-brand',
  info: 'bg-cyan text-ink',
  refill: 'bg-turquoise text-ink',
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
  amber: 'bg-amber-soft text-amber',
  outline: 'border border-line bg-surface text-ink',
};

export type ChipProps = HTMLAttributes<HTMLSpanElement> & { tone?: ChipTone };

export function Chip({ tone = 'neutral', className, ...props }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-chip px-2.5 py-1 text-xs leading-none font-semibold whitespace-nowrap',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export const statusTones = {
  booked: 'neutral',
  confirmed: 'brand',
  attended: 'success',
  noShow: 'danger',
  lateCancel: 'warning',
  cancelled: 'muted',
  waitlist: 'amber',
  offered: 'amber',
  claimed: 'refill',
  reminder2h: 'danger',
  reminder24h: 'info',
  reminderLate: 'brand',
} as const satisfies Record<string, ChipTone>;

export type Status = keyof typeof statusTones;

/** Pill for an appointment, waitlist or reminder status. Colours follow the design system mapping. */
export function StatusChip({ status, className }: { status: Status; className?: string }) {
  const t = useTranslations('ui.status');
  return (
    <Chip tone={statusTones[status]} className={className}>
      {t(status)}
    </Chip>
  );
}
