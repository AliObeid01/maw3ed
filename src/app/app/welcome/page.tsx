import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WelcomeView } from '@/components/app/WelcomeView';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.practitioner');
  return { title: t('welcomeLink') };
}

export default function Page() {
  return <WelcomeView />;
}
