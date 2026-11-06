import { OutcomeBody, OutcomeParams } from '@/server/contracts/outcomes';
import { ok, withRoute } from '@/server/http/withRoute';
import { outcomesService } from '@/server/services/outcomes';

export const dynamic = 'force-dynamic';

export const PATCH = withRoute(
  { auth: 'session', roles: ['OWNER', 'STAFF', 'PRACTITIONER'], params: OutcomeParams, body: OutcomeBody },
  async ({ ctx, params, body }) => ok(await outcomesService.mark(ctx, params.id, body.outcome)),
);
