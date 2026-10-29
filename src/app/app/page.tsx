import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { TodayPlaceholder } from '@/components/app/TodayPlaceholder';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('today') };
}

export default function TodayPage() {
  return <TodayPlaceholder />;
}
