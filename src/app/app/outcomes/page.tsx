import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OutcomesView } from '@/components/outcomes/OutcomesView';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('outcomes') };
}

export default function OutcomesPage() {
  return <OutcomesView />;
}
