import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OwnerBand, SetupSteps } from '@/components/home/OwnerSections';
import { PricingTeaser } from '@/components/home/PricingTeaser';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('home.ownersPage');
  const common = await getTranslations('common');
  return pageMetadata({
    title: t('pageTitle'),
    description: t('metaDescription'),
    path: '/for-business',
    siteName: common('appName'),
  });
}

/** For business owners: the pitch, the five setup steps and the real Free / Pro plans (same source as /pricing). */
export default function ForBusinessPage() {
  return (
    <main id="main-content" className="flex-1">
      <OwnerBand />
      <SetupSteps />
      <PricingTeaser />
    </main>
  );
}
