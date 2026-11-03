import { cn } from '@/lib/cn';

const valueTones = {
  default: 'text-ink',
  brand: 'text-brand',
  amber: 'text-amber',
  danger: 'text-danger',
  success: 'text-success',
  /** The one highlight tile ("Refilled from waitlist"): flat Turquoise with navy text only. */
  refill: 'text-ink',
} as const;

export type StatTileProps = {
  value: string | number;
  label: string;
  tone?: keyof typeof valueTones;
  className?: string;
};

export function StatTile({ value, label, tone = 'default', className }: StatTileProps) {
  const highlight = tone === 'refill';
  return (
    <div
      className={cn(
        'flex flex-col gap-0.5 rounded-tile border p-4',
        highlight ? 'border-turquoise bg-turquoise' : 'border-line bg-surface',
        className,
      )}
    >
      <span
        className={cn('text-[28px] leading-tight font-semibold tabular-nums', valueTones[tone])}
      >
        {value}
      </span>
      <span className={cn('text-sm', highlight ? 'text-ink' : 'text-muted')}>{label}</span>
    </div>
  );
}
