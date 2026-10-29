import { IdParams, SetHoursBody } from '@/server/contracts/setup';
import { ok, withRoute } from '@/server/http/withRoute';
import { hoursService } from '@/server/services/hoursService';

export const dynamic = 'force-dynamic';

export const GET = withRoute(
  { auth: 'session', roles: ['OWNER', 'STAFF'], params: IdParams },
  async ({ ctx, params }) => ok(await hoursService.get(ctx, params.id)),
);

export const PUT = withRoute(
  { auth: 'session', roles: ['OWNER'], params: IdParams, body: SetHoursBody },
  async ({ ctx, params, body }) => ok(await hoursService.replace(ctx, params.id, body)),
);
