import { CreateStaffBody } from '@/server/contracts/setup';
import { created, ok, withRoute } from '@/server/http/withRoute';
import { staffService } from '@/server/services/staffService';

export const dynamic = 'force-dynamic';

export const GET = withRoute({ auth: 'session', roles: ['OWNER', 'STAFF'] }, async ({ ctx }) =>
  ok(await staffService.list(ctx)),
);

export const POST = withRoute(
  { auth: 'session', roles: ['OWNER'], body: CreateStaffBody },
  async ({ ctx, body }) => created(await staffService.create(ctx, body)),
);
