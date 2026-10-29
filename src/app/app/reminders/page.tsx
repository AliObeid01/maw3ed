import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RemindersView } from '@/components/reminders/RemindersView';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('reminders') };
}

export default function RemindersPage() {
  return <RemindersView />;
}
