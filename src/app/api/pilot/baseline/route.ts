import { BaselineBody } from '@/server/contracts/outcomes';
import { ok, withRoute } from '@/server/http/withRoute';
import { pilotService } from '@/server/services/pilot';

export const dynamic = 'force-dynamic';

export const GET = withRoute({ auth: 'session', roles: ['OWNER'] }, async ({ ctx }) =>
  ok(await pilotService.getBaseline(ctx)),
);

export const PUT = withRoute(
  { auth: 'session', roles: ['OWNER'], body: BaselineBody },
  async ({ ctx, body }) => ok(await pilotService.putBaseline(ctx, body)),
);
