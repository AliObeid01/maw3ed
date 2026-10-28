import { cn } from '@/lib/cn';

const valueTones = {
  default: 'text-ink',
  brand: 'text-brand',
  amber: 'text-amber',
  danger: 'text-danger',
  success: 'text-success',
} as const;

export type StatTileProps = {
  value: string | number;
  label: string;
  tone?: keyof typeof valueTones;
  className?: string;
};

export function StatTile({ value, label, tone = 'default', className }: StatTileProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-0.5 rounded-tile border border-line bg-surface p-4',
        className,
      )}
    >
      <span
        className={cn('text-[28px] leading-tight font-semibold tabular-nums', valueTones[tone])}
      >
        {value}
      </span>
      <span className="text-sm text-muted">{label}</span>
    </div>
  );
}
