import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { HowItWorks } from '@/components/home/HowItWorks';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('home.howPage');
  const common = await getTranslations('common');
  return pageMetadata({
    title: t('pageTitle'),
    description: t('metaDescription'),
    path: '/how-it-works',
    siteName: common('appName'),
  });
}

/** How booking and reminders work for clients. Server-rendered; the FAQ is native `<details>` (works without JavaScript). */
export default function HowItWorksPage() {
  return (
    <main id="main-content" className="flex-1">
      <HowItWorks />
    </main>
  );
}
