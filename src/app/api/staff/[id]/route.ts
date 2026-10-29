import { IdParams, UpdateStaffBody } from '@/server/contracts/setup';
import { ok, withRoute } from '@/server/http/withRoute';
import { staffService } from '@/server/services/staffService';

export const dynamic = 'force-dynamic';

export const PATCH = withRoute(
  { auth: 'session', roles: ['OWNER'], params: IdParams, body: UpdateStaffBody },
  async ({ ctx, params, body }) => ok(await staffService.update(ctx, params.id, body)),
);
