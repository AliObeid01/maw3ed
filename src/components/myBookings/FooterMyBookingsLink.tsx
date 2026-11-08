'use client';

import { PendingLink as Link } from '@/components/public/PendingLink';
import { useTranslations } from 'next-intl';
import { useSavedCount } from './useSavedBookings';

/** The footer's "My bookings" item: rendered only on a device that has saved bookings (nothing on the server). */
export function FooterMyBookingsLink({ className }: { className: string }) {
  const t = useTranslations('public.footer');
  if (useSavedCount() === 0) return null;
  return (
    <li>
      <Link href="/my-bookings" className={className}>
        {t('myBookings')}
      </Link>
    </li>
  );
}
