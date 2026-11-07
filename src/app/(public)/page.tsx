import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CategoryExplorer } from '@/components/home/CategoryExplorer';
import { HomeHero } from '@/components/home/HomeHero';
import { HowItWorks } from '@/components/home/HowItWorks';
import { OwnerBand, SetupSteps } from '@/components/home/OwnerSections';
import { PricingTeaser } from '@/components/home/PricingTeaser';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('home');
  const common = await getTranslations('common');
  return pageMetadata({
    title: t('pageTitle'),
    description: t('metaDescription'),
    path: '/',
    siteName: common('appName'),
  });
}

/** The marketplace home: hero search, browse by category, how it works, owners, pricing. The header and footer come from the layout. */
export default async function Home() {
  const t = await getTranslations('home.categories');
  return (
    <main id="main-content" className="flex-1">
      <HomeHero />
      <section aria-labelledby="categories-title" className="mx-auto max-w-[1200px] px-4 pt-16 md:px-6 md:pt-[88px]">
        <div className="max-w-[640px]">
          <h2 id="categories-title" className="m-0 text-[clamp(27px,4.4vw,38px)] leading-[1.12] font-bold tracking-[-0.02em] rtl:tracking-normal">
            {t('title')}
          </h2>
          <p className="m-0 mt-2 text-[17px] text-muted">{t('subtitle')}</p>
        </div>
        <CategoryExplorer />
      </section>
      <HowItWorks />
      <OwnerBand />
      <SetupSteps />
      <PricingTeaser />
    </main>
  );
}
