import { IdParams, SetStaffServicesBody } from '@/server/contracts/setup';
import { ok, withRoute } from '@/server/http/withRoute';
import { staffService } from '@/server/services/staffService';

export const dynamic = 'force-dynamic';

export const PUT = withRoute(
  { auth: 'session', roles: ['OWNER'], params: IdParams, body: SetStaffServicesBody },
  async ({ ctx, params, body }) => ok(await staffService.setServices(ctx, params.id, body)),
);
