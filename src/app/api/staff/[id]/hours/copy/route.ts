import { CopyHoursBody, IdParams } from '@/server/contracts/setup';
import { ok, withRoute } from '@/server/http/withRoute';
import { hoursService } from '@/server/services/hoursService';

export const dynamic = 'force-dynamic';

export const POST = withRoute(
  { auth: 'session', roles: ['OWNER'], params: IdParams, body: CopyHoursBody },
  async ({ ctx, params, body }) =>
    ok(await hoursService.copyTo(ctx, params.id, body.targetStaffIds)),
);
