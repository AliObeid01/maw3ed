'use client';

import { CalendarCheck, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { useSavedBookings } from './useSavedBookings';

/**
 * "Your bookings here" on a business's booking page: shown only when this device has saved bookings for that
 * business, and links to the full list. Read from this browser, so it is absent on the server (the business data
 * behind this page loads in the browser too, so it appears together with the page and shifts nothing).
 */
export function YourBookingsStrip({ slug, className }: { slug: string; className?: string }) {
  const t = useTranslations('myBookings.strip');
  const count = useSavedBookings().filter((e) => e.slug === slug).length;
  if (count === 0) return null;
  return (
    <Link
      href="/my-bookings"
      data-testid="your-bookings-strip"
      className={cn(
        'flex min-h-14 w-full items-center gap-3 rounded-card-sm border border-line bg-surface px-4 py-2.5 text-ink no-underline transition-colors duration-200 ease-out hover:bg-canvas motion-reduce:transition-none',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-nav bg-brand-soft text-brand"
      >
        <CalendarCheck size={20} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-semibold">{t('title')}</span>
        <span className="text-sm text-muted">{t('count', { count })}</span>
      </span>
      <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-muted rtl:-scale-x-100" />
    </Link>
  );
}
