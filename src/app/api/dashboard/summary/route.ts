import { ok, withRoute } from '@/server/http/withRoute';
import { dashboardService } from '@/server/services/dashboard';

export const dynamic = 'force-dynamic';

export const GET = withRoute({ auth: 'session', roles: ['OWNER', 'STAFF'] }, async ({ ctx }) =>
  ok(await dashboardService.summary(ctx)),
);
