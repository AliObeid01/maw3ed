import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { StaffView } from '@/components/app/setup/StaffView';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('staff') };
}

export default function Page() {
  return <StaffView />;
}
