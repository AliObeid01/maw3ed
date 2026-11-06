import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { FrontDeskForm } from '@/components/frontdesk/FrontDeskForm';
import { assertPractitionerPath } from '@/app/app/practitionerGuard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('book') };
}

export default async function BookPage() {
  await assertPractitionerPath('/app/book');
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense>
      <FrontDeskForm />
    </Suspense>
  );
}
