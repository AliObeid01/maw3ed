import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SetupChecklist } from '@/components/app/setup/SetupChecklist';
import { assertPractitionerPath } from '@/app/app/practitionerGuard';
import { ownerConnectorInfo } from '@/server/mcp/ownerUi';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('setup') };
}

export default async function Page() {
  await assertPractitionerPath('/app/setup');
  return <SetupChecklist connectorUrl={(await ownerConnectorInfo())?.url} />;
}
