import { SlugCheckQuery } from '@/server/contracts/auth';
import { json, withRoute } from '@/server/http/withRoute';
import { authService } from '@/server/services/auth';

export const dynamic = 'force-dynamic';

export const GET = withRoute({ auth: 'public', query: SlugCheckQuery }, async ({ query }) =>
  json(await authService.slugCheck(query.slug), 200, { 'Cache-Control': 'no-store' }),
);
