import { GrantParams } from '@/server/contracts/oauthGrants';
import { noContent, withRoute } from '@/server/http/withRoute';
import { isOwnerConnectorEnabled } from '@/server/mcp/ownerConfig';
import { oauthGrantsService } from '@/server/services/oauthGrants';

export const dynamic = 'force-dynamic';

/** Disconnect one app (owner). 404 while MCP_OWNER_ENABLED is off. */
export const POST = withRoute(
  { gate: isOwnerConnectorEnabled, auth: 'session', roles: ['OWNER'], params: GrantParams, rateLimit: { policy: 'oauthPageIp' } },
  async ({ ctx, params }) => {
    await oauthGrantsService.revoke(ctx, params.id);
    return noContent();
  },
);
