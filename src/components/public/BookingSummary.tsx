import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';

export type SummaryRow = {
  id: string;
  label: string;
  /** Undefined renders the muted placeholder. */
  value?: string;
  /** Placeholder when empty; defaults to an em dash. */
  empty?: string;
};

export type BookingSummaryProps = {
  rows: SummaryRow[];
  className?: string;
  /** Render without the card chrome (inside a sheet). */
  bare?: boolean;
};

/** "Your booking" label/value grid (board 02, right column). */
export function BookingSummary({ rows, className, bare }: BookingSummaryProps) {
  const t = useTranslations('public.summary');
  const body = (
    <>
      {bare ? null : <h2 className="text-base font-semibold">{t('title')}</h2>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-2.5 text-sm">
        {rows.map((row) => (
          <div key={row.id} className="col-span-2 grid grid-cols-subgrid">
            <dt className="text-muted">{row.label}</dt>
            <dd className={cn('m-0 min-w-0', row.value ? 'font-medium text-ink' : 'text-subtle')}>
              {row.value ?? row.empty ?? t('empty')}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
  if (bare) return <div className={cn('flex flex-col gap-3.5', className)}>{body}</div>;
  return <Card className={cn('flex flex-col gap-3.5', className)}>{body}</Card>;
}
