import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SetupChecklist } from '@/components/app/setup/SetupChecklist';
import { assertPractitionerPath } from '@/app/app/practitionerGuard';
import { ownerConnectorUrlFor } from '@/server/mcp/ownerUi';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('setup') };
}

export default async function Page() {
  const session = await assertPractitionerPath('/app/setup');
  return <SetupChecklist connectorUrl={await ownerConnectorUrlFor(session.role)} />;
}
