import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { TodayView } from '@/components/dashboard/TodayView';
import { assertPractitionerPath } from '@/app/app/practitionerGuard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('today') };
}

export default async function TodayPage() {
  await assertPractitionerPath('/app');
  return <TodayView />;
}
