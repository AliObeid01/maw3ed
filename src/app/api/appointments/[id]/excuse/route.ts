import { ExcuseBody, OutcomeParams } from '@/server/contracts/outcomes';
import { ok, withRoute } from '@/server/http/withRoute';
import { outcomesService } from '@/server/services/outcomes';

export const dynamic = 'force-dynamic';

export const POST = withRoute(
  { auth: 'session', roles: ['OWNER', 'STAFF'], params: OutcomeParams, body: ExcuseBody },
  async ({ ctx, params }) => ok(await outcomesService.excuse(ctx, params.id)),
);
