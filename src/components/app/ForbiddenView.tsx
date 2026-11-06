import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { buttonClasses } from '@/components/ui/Button';
import { PRACTITIONER_HOME } from '@/lib/auth/practitionerPaths';

/**
 * The closed state of the /app layout for a barber whose current page cannot be determined (the guard fails
 * closed instead of rendering the page). A plain link, not a redirect: a redirect would loop on an allowed page.
 */
export async function ForbiddenView() {
  const t = await getTranslations('app.practitioner');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="m-0 text-xl font-semibold">{t('forbiddenTitle')}</h1>
      <p className="m-0 text-sm text-muted">{t('forbiddenBody')}</p>
      <Link href={PRACTITIONER_HOME} className={buttonClasses({ variant: 'secondary', size: 'lg' })}>
        {t('todayLink')}
      </Link>
    </main>
  );
}
