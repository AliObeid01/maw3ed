import { getTranslations } from 'next-intl/server';
import { Logo } from '@/components/brand/Logo';

export default async function Home() {
  const t = await getTranslations('common');
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-start justify-center gap-4 px-5">
      <Logo label={t('appName')} width={180} height={42} />
      <p className="text-lg text-muted">{t('tagline')}</p>
    </main>
  );
}
