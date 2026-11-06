import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AccountView } from '@/components/app/account/AccountView';
import { assertPractitionerPath } from '@/app/app/practitionerGuard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('account') };
}

export default async function Page() {
  await assertPractitionerPath('/app/account');
  return <AccountView />;
}
