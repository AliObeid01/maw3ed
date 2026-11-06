import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { assertPractitionerPath } from '@/app/app/practitionerGuard';
import { BarberTodayView } from '@/components/dashboard/BarberTodayView';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('today') };
}

/** The barber's own schedule. Owners and receptionists have their Today at /app. */
export default async function BarberTodayPage() {
  const session = await assertPractitionerPath('/app/today');
  if (session.role !== 'PRACTITIONER') redirect('/app');
  return <BarberTodayView />;
}
