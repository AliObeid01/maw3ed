import { InviteBody } from '@/server/contracts/auth';
import { created, ok, withRoute } from '@/server/http/withRoute';
import { invitesService } from '@/server/services/invites';

export const dynamic = 'force-dynamic';

export const GET = withRoute({ auth: 'session', roles: ['OWNER'] }, async ({ ctx }) =>
  ok(await invitesService.listPending(ctx)),
);

export const POST = withRoute(
  { auth: 'session', roles: ['OWNER'], body: InviteBody },
  async ({ ctx, body }) => created(await invitesService.create(ctx, body)),
);
