import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AppointmentView } from '@/components/appointments/AppointmentView';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('appointment') };
}

export default async function AppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppointmentView id={id} />;
}
