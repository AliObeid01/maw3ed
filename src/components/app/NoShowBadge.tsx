import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

/** White pill with a danger outline: "N no-shows". Shown on every booking of a repeat no-shower. */
export function NoShowBadge({ count, className }: { count: number; className?: string }) {
  const t = useTranslations('app.dashboard');
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill border border-danger-line bg-surface px-[7px] py-px text-[11px] leading-snug font-semibold whitespace-nowrap text-danger',
        className,
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-pill bg-danger" />
      {t('noShows', { count })}
    </span>
  );
}
