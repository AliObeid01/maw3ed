import { getTranslations } from 'next-intl/server';
import { ExploreSkeleton } from '@/components/explore/ExploreView';
import { Skeleton } from '@/components/ui/Skeleton';
import { LoadingFlag } from './LoadingFlag';

type Variant = 'directory' | 'how' | 'business' | 'pricing';

/**
 * Route `loading.tsx` skeletons for the public pages: the same wrapper and block sizes as the real page, so the
 * header and footer (from the layout) stay put and nothing shifts when the page arrives. One polite status line for
 * assistive technology; the blocks are decorative. Server component: no client JavaScript.
 */
export async function PageLoading({ variant }: { variant: Variant }) {
  const t = await getTranslations('public');
  const status = (
    <>
      <p role="status" className="sr-only">
        {t('loadingPage')}
      </p>
      <LoadingFlag />
    </>
  );

  if (variant === 'directory') {
    return (
      <main id="main-content" className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-6 px-4 py-8 md:px-8 md:py-12">
        {status}
        <div className="flex flex-col gap-2" aria-hidden="true">
          <Skeleton className="h-[46px] w-[260px] max-w-full rounded-nav" />
          <Skeleton className="h-6 w-[420px] max-w-full rounded-nav" />
        </div>
        <ExploreSkeleton />
      </main>
    );
  }

  if (variant === 'how') {
    return (
      <main id="main-content" className="flex-1">
        {status}
        <div aria-hidden="true" className="mx-auto max-w-[1200px] px-4 pt-12 pb-16 md:px-6 md:pt-[72px] md:pb-[88px]">
          <Skeleton className="h-4 w-28 rounded-nav" />
          <Skeleton className="mt-3 h-[46px] w-[320px] max-w-full rounded-nav" />
          <Skeleton className="mt-3 h-6 w-[420px] max-w-full rounded-nav" />
          <div className="mt-9 grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[236px] rounded-[22px]" />
            ))}
          </div>
          <Skeleton className="mt-[72px] h-[360px] rounded-[22px]" />
        </div>
      </main>
    );
  }

  if (variant === 'business') {
    return (
      <main id="main-content" className="flex-1">
        {status}
        <div aria-hidden="true">
          <Skeleton className="h-[460px] rounded-none sm:h-[420px] lg:h-[380px]" />
          <div className="mx-auto max-w-[1200px] px-4 pt-16 md:px-6 md:pt-[88px]">
            <Skeleton className="h-[46px] w-[300px] max-w-full rounded-nav" />
            <div className="mt-8 grid gap-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-[68px] rounded-[16px]" />
              ))}
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main id="main-content" className="flex-1">
      {status}
      <div aria-hidden="true" className="flex flex-1 flex-col">
        <div className="bg-hero px-4 pt-10 pb-20 md:px-8 md:pt-14 md:pb-24">
          <div className="mx-auto flex max-w-[1000px] flex-col items-center gap-3.5">
            <Skeleton className="h-[40px] w-[300px] max-w-full rounded-nav bg-white/15 md:h-[56px]" />
            <Skeleton className="h-6 w-[420px] max-w-full rounded-nav bg-white/15" />
          </div>
        </div>
        <div className="mx-auto grid w-full max-w-[1000px] gap-5 px-4 py-10 md:grid-cols-2 md:px-8">
          <Skeleton className="h-[420px] rounded-[24px]" />
          <Skeleton className="h-[420px] rounded-[24px]" />
        </div>
      </div>
    </main>
  );
}
