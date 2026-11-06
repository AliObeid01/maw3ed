import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PilotView } from '@/components/pilot/PilotView';
import { assertPractitionerPath } from '@/app/app/practitionerGuard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('pilot') };
}

export default async function PilotPage() {
  await assertPractitionerPath('/app/pilot');
  return <PilotView />;
}
