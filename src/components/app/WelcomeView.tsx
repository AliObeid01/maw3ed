'use client';

import { CalendarClock } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { buttonClasses } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useAppSession } from './SessionContext';

/** The PRACTITIONER landing page until the scoped schedule screens arrive. */
export function WelcomeView() {
  const t = useTranslations('app.practitioner');
  const { userName } = useAppSession();
  return (
    <Card className="flex flex-col items-center gap-3 py-10 text-center">
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-pill bg-brand-soft text-brand"
      >
        <CalendarClock size={22} />
      </span>
      <h1 className="m-0 text-xl font-semibold">{t('welcomeTitle', { name: userName })}</h1>
      <p className="m-0 max-w-sm text-sm text-muted">{t('welcomeBody')}</p>
      <Link href="/app/account" className={buttonClasses({ variant: 'secondary', size: 'lg' })}>
        {t('accountLink')}
      </Link>
    </Card>
  );
}
