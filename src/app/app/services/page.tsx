import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ServicesView } from '@/components/app/setup/ServicesView';
import { assertPractitionerPath } from '@/app/app/practitionerGuard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('services') };
}

export default async function Page() {
  await assertPractitionerPath('/app/services');
  return <ServicesView />;
}
