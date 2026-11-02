import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AccountView } from '@/components/app/account/AccountView';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('account') };
}

export default function Page() {
  return <AccountView />;
}
