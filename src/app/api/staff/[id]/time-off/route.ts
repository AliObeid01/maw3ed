import { CreateTimeOffBody, IdParams, TimeOffListQuery } from '@/server/contracts/setup';
import { created, ok, withRoute } from '@/server/http/withRoute';
import { timeOffService } from '@/server/services/timeOffService';

export const dynamic = 'force-dynamic';

export const GET = withRoute(
  { auth: 'session', roles: ['OWNER', 'STAFF'], params: IdParams, query: TimeOffListQuery },
  async ({ ctx, params, query }) => ok(await timeOffService.list(ctx, params.id, query)),
);

export const POST = withRoute(
  { auth: 'session', roles: ['OWNER'], params: IdParams, body: CreateTimeOffBody },
  async ({ ctx, params, body }) => created(await timeOffService.create(ctx, params.id, body)),
);
