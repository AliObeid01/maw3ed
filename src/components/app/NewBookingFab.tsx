import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

/** 56 px floating "New booking" above the tab bar, on the end side. Hidden at `lg` (the sidebar has the button). */
export function NewBookingFab({
  href,
  active,
  className,
}: {
  href: string;
  active?: boolean;
  className?: string;
}) {
  const t = useTranslations('app.nav');
  return (
    <Link
      href={href}
      aria-label={t('newBooking')}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'fixed end-4 bottom-[calc(64px+env(safe-area-inset-bottom)+16px)] z-30 flex size-14 items-center justify-center rounded-pill bg-brand text-white shadow-[0_1px_3px_rgb(0_0_0/0.06),0_6px_16px_rgb(23_76_79/0.25)] transition-colors duration-200 ease-out hover:bg-brand-hover lg:hidden',
        className,
      )}
    >
      <Plus size={26} strokeWidth={2.5} aria-hidden="true" />
    </Link>
  );
}
