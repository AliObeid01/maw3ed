import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PilotView } from '@/components/pilot/PilotView';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('pilot') };
}

export default function PilotPage() {
  return <PilotView />;
}
