import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ClientHistoryView } from '@/components/clients/ClientHistoryView';
import { assertPractitionerPath } from '@/app/app/practitionerGuard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('client') };
}

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await assertPractitionerPath(`/app/clients/${id}`);
  return <ClientHistoryView id={id} />;
}
