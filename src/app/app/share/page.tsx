import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ShareView } from '@/components/app/setup/ShareView';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('share') };
}

export default function Page() {
  return <ShareView />;
}
