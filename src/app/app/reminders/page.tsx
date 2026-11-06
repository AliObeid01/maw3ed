import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RemindersView } from '@/components/reminders/RemindersView';
import { assertPractitionerPath } from '@/app/app/practitionerGuard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('reminders') };
}

export default async function RemindersPage() {
  await assertPractitionerPath('/app/reminders');
  return <RemindersView />;
}
