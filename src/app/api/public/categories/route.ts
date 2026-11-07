import { CategoriesQuery } from '@/server/contracts/directory';
import { json, withRoute } from '@/server/http/withRoute';
import { categoriesService } from '@/server/services/categories';

export const dynamic = 'force-dynamic';

/** Public, non-personal aggregates (live slots for a bounded set): safe for the CDN to cache briefly. */
export const GET = withRoute(
  { auth: 'public', rateLimit: { policy: 'directoryLive' }, query: CategoriesQuery },
  async ({ query }) =>
    json(await categoriesService.list(query), 200, {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    }),
);
