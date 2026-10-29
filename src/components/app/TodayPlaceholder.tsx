'use client';

import { CalendarDays } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { useAppSession } from './SessionContext';
import { EmptyState } from './states';

/** Stand-in for board 4.1 until the real Today screen lands. */
export function TodayPlaceholder() {
  const t = useTranslations('app.today');
  const { userName, role } = useAppSession();
  return (
    <>
      <h2 className="m-0 text-2xl font-semibold">{t('greeting', { name: userName })}</h2>
      <EmptyState
        icon={<CalendarDays size={22} />}
        title={t('soonTitle')}
        body={t('soonBody')}
        action={
          role === 'OWNER' ? (
            <Link href="/app/setup" className={buttonClasses({})}>
              {t('setupCta')}
            </Link>
          ) : undefined
        }
      />
    </>
  );
}
