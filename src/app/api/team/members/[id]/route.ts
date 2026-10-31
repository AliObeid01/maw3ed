import { TeamIdParams } from '@/server/contracts/team';
import { ok, withRoute } from '@/server/http/withRoute';
import { teamService } from '@/server/services/team';

export const dynamic = 'force-dynamic';

export const DELETE = withRoute(
  { auth: 'session', roles: ['OWNER'], params: TeamIdParams },
  async ({ ctx, params }) => ok(await teamService.removeMember(ctx, params.id)),
);
