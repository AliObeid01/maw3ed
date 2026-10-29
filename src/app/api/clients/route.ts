import { ClientsQuery } from '@/server/contracts/outcomes';
import { ok, withRoute } from '@/server/http/withRoute';
import { clientsService } from '@/server/services/clients';

export const dynamic = 'force-dynamic';

export const GET = withRoute(
  { auth: 'session', roles: ['OWNER', 'STAFF'], query: ClientsQuery },
  async ({ ctx, query }) => ok(await clientsService.list(ctx, query)),
);
