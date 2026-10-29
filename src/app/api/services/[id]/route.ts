import { IdParams, UpdateServiceBody } from '@/server/contracts/setup';
import { ok, withRoute } from '@/server/http/withRoute';
import { catalogService } from '@/server/services/catalogService';

export const dynamic = 'force-dynamic';

export const PATCH = withRoute(
  { auth: 'session', roles: ['OWNER'], params: IdParams, body: UpdateServiceBody },
  async ({ ctx, params, body }) => ok(await catalogService.update(ctx, params.id, body)),
);
