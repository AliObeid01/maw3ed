import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SettingsView } from '@/components/app/setup/SettingsView';
import { assertPractitionerPath } from '@/app/app/practitionerGuard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('settings') };
}

export default async function Page() {
  await assertPractitionerPath('/app/settings');
  return <SettingsView />;
}
