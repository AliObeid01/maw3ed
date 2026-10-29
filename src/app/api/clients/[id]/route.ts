import { ClientParams } from '@/server/contracts/outcomes';
import { noContent, ok, withRoute } from '@/server/http/withRoute';
import { clientsService } from '@/server/services/clients';

export const dynamic = 'force-dynamic';

export const GET = withRoute(
  { auth: 'session', roles: ['OWNER', 'STAFF'], params: ClientParams },
  async ({ ctx, params }) => ok(await clientsService.get(ctx, params.id)),
);

export const DELETE = withRoute(
  { auth: 'session', roles: ['OWNER'], params: ClientParams },
  async ({ ctx, params }) => {
    await clientsService.remove(ctx, params.id);
    return noContent();
  },
);
