import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { ExploreSkeleton, ExploreView } from '@/components/explore/ExploreView';
import { pageMetadata } from '@/lib/seo';

const FILTER_PARAMS = ['search', 'service', 'area', 'category', 'when', 'cursor'] as const;

/**
 * Title and description from next-intl, canonical `/directory`. A URL that carries filters is a variation of the same
 * list, so it is `noindex` (the plain `/directory` stays indexable).
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const t = await getTranslations('directory');
  const common = await getTranslations('common');
  const query = await searchParams;
  const filtered = FILTER_PARAMS.some((name) => {
    const value = query[name];
    return Array.isArray(value) ? value.some(Boolean) : Boolean(value);
  });
  return {
    ...pageMetadata({
      title: t('pageTitle'),
      description: t('metaDescription'),
      path: '/directory',
      siteName: common('appName'),
    }),
    ...(filtered ? { robots: { index: false, follow: true } } : {}),
  };
}

/** Explore: the filters and results load in the browser (public API + skeleton); the heading is server-rendered. */
export default async function DirectoryPage() {
  const t = await getTranslations('directory');
  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-6 px-4 py-8 md:px-8 md:py-12"
    >
      <header className="flex flex-col gap-2">
        <h1 className="m-0 text-[clamp(28px,5vw,42px)] leading-[1.12] font-bold tracking-[-0.02em] rtl:tracking-normal">
          {t('title')}
        </h1>
        <p className="m-0 max-w-xl text-[15px] text-muted md:text-[17px]">{t('subtitle')}</p>
      </header>
      {/* useSearchParams (the URL filters) needs a Suspense boundary. */}
      <Suspense fallback={<ExploreSkeleton />}>
        <ExploreView />
      </Suspense>
    </main>
  );
}
