import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WaitlistView } from '@/components/waitlist/WaitlistView';
import { assertPractitionerPath } from '@/app/app/practitionerGuard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('waitlist') };
}

// The session guard is the /app layout (`loadSession`): signed-out visitors never reach this page.
export default async function WaitlistPage() {
  await assertPractitionerPath('/app/waitlist');
  return <WaitlistView />;
}
