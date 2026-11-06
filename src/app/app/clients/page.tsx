import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ClientsView } from '@/components/clients/ClientsView';
import { assertPractitionerPath } from '@/app/app/practitionerGuard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('clients') };
}

export default async function ClientsPage() {
  await assertPractitionerPath('/app/clients');
  return <ClientsView />;
}
