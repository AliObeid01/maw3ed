import { TodayQuery } from '@/server/contracts/outcomes';
import { ok, withRoute } from '@/server/http/withRoute';
import { dashboardService } from '@/server/services/dashboard';

export const dynamic = 'force-dynamic';

export const GET = withRoute(
  { auth: 'session', roles: ['OWNER', 'STAFF'], query: TodayQuery },
  async ({ ctx, query }) => ok(await dashboardService.today(ctx, query)),
);
