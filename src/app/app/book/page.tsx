import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { FrontDeskForm } from '@/components/frontdesk/FrontDeskForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('book') };
}

export default function BookPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense>
      <FrontDeskForm />
    </Suspense>
  );
}
