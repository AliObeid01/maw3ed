'use client';

import { ChevronUp, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { cn } from '@/lib/cn';
import { BookingSummary, type SummaryRow } from './BookingSummary';

export type StickySummaryBarProps = {
  rows: SummaryRow[];
  /** Formatted price (use next-intl `format.number`), or undefined before a service is chosen. */
  price?: string;
  /** Primary call to action, e.g. "Continue". */
  cta: ReactNode;
  onCta?: () => void;
  ctaDisabled?: boolean;
  ctaLoading?: boolean;
  /** One short line of muted text under the price and CTA (e.g. the free-cancellation cutoff). Hidden at `lg` with the bar. */
  note?: ReactNode;
  className?: string;
};

/**
 * Phones only (hidden at `lg`): fixed bottom bar with the price and the primary CTA.
 * Tapping the summary part opens the full "Your booking" in a sheet. Parents need ~88 px bottom padding.
 */
export function StickySummaryBar({
  rows,
  price,
  cta,
  onCta,
  ctaDisabled,
  ctaLoading,
  note,
  className,
}: StickySummaryBarProps) {
  const t = useTranslations('public.summary');
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-30 border-t border-divider bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden',
          className,
        )}
      >
        <div className="mx-auto flex max-w-[1240px] items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            className="flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center rounded-input text-start"
          >
            <span className="flex items-center gap-1 text-[13px] text-muted">
              {t('open')}
              <ChevronUp size={14} aria-hidden="true" />
            </span>
            <span className="text-lg leading-tight font-semibold tabular-nums">
              {price ?? t('empty')}
            </span>
          </button>
          <Button size="lg" onClick={onCta} disabled={ctaDisabled} loading={ctaLoading}>
            {cta}
          </Button>
        </div>
        {note ? (
          <p className="mx-auto -mt-1 flex max-w-[1240px] items-start gap-1.5 px-4 pb-2.5 text-[13px] leading-snug text-muted">
            <ShieldCheck size={14} aria-hidden="true" className="mt-px shrink-0" />
            <span className="min-w-0">{note}</span>
          </p>
        ) : null}
      </div>
      <Sheet open={open} onOpenChange={setOpen} title={t('title')} closeLabel={t('close')}>
        <BookingSummary rows={rows} bare />
      </Sheet>
    </>
  );
}
