import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { assertPractitionerPath } from '@/app/app/practitionerGuard';
import { AppointmentView } from '@/components/appointments/AppointmentView';
import { BarberAppointmentView } from '@/components/appointments/BarberAppointment';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('appointment') };
}

export default async function AppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await assertPractitionerPath(`/app/appointments/${id}`);
  // The barber's page asks the scoped endpoint, so another barber's appointment is the same "not found" page.
  return session.role === 'PRACTITIONER' ? <BarberAppointmentView id={id} /> : <AppointmentView id={id} />;
}
