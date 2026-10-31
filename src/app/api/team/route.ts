import { ok, withRoute } from '@/server/http/withRoute';
import { teamService } from '@/server/services/team';

export const dynamic = 'force-dynamic';

export const GET = withRoute({ auth: 'session', roles: ['OWNER'] }, async ({ ctx }) =>
  ok(await teamService.list(ctx)),
);
