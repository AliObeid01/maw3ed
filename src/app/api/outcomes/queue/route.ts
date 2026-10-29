import { QueueQuery } from '@/server/contracts/outcomes';
import { ok, withRoute } from '@/server/http/withRoute';
import { outcomesService } from '@/server/services/outcomes';

export const dynamic = 'force-dynamic';

export const GET = withRoute(
  { auth: 'session', roles: ['OWNER', 'STAFF'], query: QueueQuery },
  async ({ ctx, query }) => ok(await outcomesService.queue(ctx, query.limit)),
);
