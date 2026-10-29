import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SetupChecklist } from '@/components/app/setup/SetupChecklist';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('setup') };
}

export default function Page() {
  return <SetupChecklist />;
}
