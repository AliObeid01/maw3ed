import { UpdateBusinessBody } from '@/server/contracts/setup';
import { ok, withRoute } from '@/server/http/withRoute';
import { businessService } from '@/server/services/businessService';

export const dynamic = 'force-dynamic';

export const GET = withRoute({ auth: 'session', roles: ['OWNER', 'STAFF'] }, async ({ ctx }) =>
  ok(await businessService.get(ctx)),
);

export const PATCH = withRoute(
  { auth: 'session', roles: ['OWNER'], body: UpdateBusinessBody },
  async ({ ctx, body }) => ok(await businessService.update(ctx, body)),
);
