import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OwnerBand, SetupSteps } from '@/components/home/OwnerSections';
import { PlansSection } from '@/components/home/PlansSection';
import { HashScroll } from '@/components/public/HashScroll';
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

/** For business owners: the pitch, the five setup steps and the real Free / Pro plans (`#plans` is where the old /pricing redirects). */
export default function ForBusinessPage() {
  return (
    <main id="main-content" className="flex-1">
      <OwnerBand />
      <SetupSteps />
      <PlansSection />
      <HashScroll />
    </main>
  );
}
