import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ServicesView } from '@/components/app/setup/ServicesView';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('services') };
}

export default function Page() {
  return <ServicesView />;
}
