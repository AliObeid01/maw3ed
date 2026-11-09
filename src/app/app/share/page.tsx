import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ShareView } from '@/components/app/setup/ShareView';
import { isAssistantEnabled } from '@/lib/assistant';
import { assertPractitionerPath } from '@/app/app/practitionerGuard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('share') };
}

export default async function Page() {
  await assertPractitionerPath('/app/share');
  return <ShareView assistantEnabled={isAssistantEnabled()} />;
}
