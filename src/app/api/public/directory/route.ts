import { DirectoryQuery } from '@/server/contracts/directory';
import { json, withRoute } from '@/server/http/withRoute';
import { directoryService } from '@/server/services/directory';

export const dynamic = 'force-dynamic';

/** Public, non-personal listing: safe for the CDN to cache briefly. */
export const GET = withRoute(
  { auth: 'public', rateLimit: { policy: 'directory' }, query: DirectoryQuery },
  async ({ query, ctx }) =>
    json(await directoryService.list(query, ctx.ip), 200, {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    }),
);
