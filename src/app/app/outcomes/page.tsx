import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OutcomesView } from '@/components/outcomes/OutcomesView';
import { assertPractitionerPath } from '@/app/app/practitionerGuard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('outcomes') };
}

export default async function OutcomesPage() {
  await assertPractitionerPath('/app/outcomes');
  return <OutcomesView />;
}
