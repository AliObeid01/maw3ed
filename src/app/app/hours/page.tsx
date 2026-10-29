import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { HoursView } from '@/components/app/setup/HoursView';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('hours') };
}

export default function Page() {
  return <HoursView />;
}
