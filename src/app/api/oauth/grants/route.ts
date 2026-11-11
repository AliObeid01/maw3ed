import { ok, withRoute } from '@/server/http/withRoute';
import { isOwnerConnectorEnabled } from '@/server/mcp/ownerConfig';
import { oauthGrantsService } from '@/server/services/oauthGrants';

export const dynamic = 'force-dynamic';

/** Connected apps of this business (owner). 404 while MCP_OWNER_ENABLED is off, like every route of the owner connector. */
export const GET = withRoute(
  { gate: isOwnerConnectorEnabled, auth: 'session', roles: ['OWNER'], rateLimit: { policy: 'oauthPageIp' } },
  async ({ ctx }) => ok(await oauthGrantsService.list(ctx)),
);
