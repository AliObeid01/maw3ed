import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ClientsView } from '@/components/clients/ClientsView';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('clients') };
}

export default function ClientsPage() {
  return <ClientsView />;
}
