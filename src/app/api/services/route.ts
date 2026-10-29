import { CreateServiceBody, ServiceListQuery } from '@/server/contracts/setup';
import { created, ok, withRoute } from '@/server/http/withRoute';
import { catalogService } from '@/server/services/catalogService';

export const dynamic = 'force-dynamic';

export const GET = withRoute(
  { auth: 'session', roles: ['OWNER', 'STAFF'], query: ServiceListQuery },
  async ({ ctx, query }) => ok(await catalogService.list(ctx, query)),
);

export const POST = withRoute(
  { auth: 'session', roles: ['OWNER'], body: CreateServiceBody },
  async ({ ctx, body }) => created(await catalogService.create(ctx, body)),
);
