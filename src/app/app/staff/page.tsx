import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { StaffView } from '@/components/app/setup/StaffView';
import { assertPractitionerPath } from '@/app/app/practitionerGuard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('staff') };
}

export default async function Page() {
  await assertPractitionerPath('/app/staff');
  return <StaffView />;
}
