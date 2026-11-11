import { clientIp, UNKNOWN_IP } from '@/server/http/clientIp';
import { notFoundResponse } from '@/server/http/oauthRoute';
import { handleMcpRequest, type McpHandlerDeps } from '@/server/mcp/protocol';
import { isOwnerConnectorEnabled, protectedResourceMetadataUrl } from '@/server/mcp/ownerConfig';
import { callOwnerTool, listOwnerTools } from '@/server/mcp/ownerTools';
import { authenticateBearer, OAuthError } from '@/server/services/oauth';
import { rateLimiter, routeRateLimitDisabled } from '@/server/services/rateLimit';

export const dynamic = 'force-dynamic';

const BEARER = /^Bearer\s+(\S+)\s*$/i;

function unauthorized(invalid: boolean): Response {
  const resource = `resource_metadata="${protectedResourceMetadataUrl()}"`;
  return Response.json(
    {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: invalid ? 'The access token is invalid or expired.' : 'Authentication required.' },
    },
    {
      status: 401,
      headers: {
        'www-authenticate': `Bearer ${resource}${invalid ? ', error="invalid_token"' : ''}`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    },
  );
}

const deps: McpHandlerDeps = {
  get env() {
    return process.env;
  },
  enabled: isOwnerConnectorEnabled,
  tools: listOwnerTools,
  callTool: callOwnerTool,
  routeName: '/api/mcp/owner',
  async authenticate(req) {
    const header = req.headers.get('authorization');
    const raw = header ? BEARER.exec(header)?.[1] : undefined;
    // No token: the normal first request of every client; answer the challenge, count nothing (Claude's egress is shared).
    if (!raw) return unauthorized(false);
    // A token was sent: invalid tokens are budgeted per ip so a script cannot hammer the lookup.
    const ip = clientIp(req);
    if (ip !== UNKNOWN_IP && !routeRateLimitDisabled()) {
      const d = await rateLimiter.consume('mcpOwnerBadAuthIp', ip);
      // Count only failures: give the hit back below when the token turns out to be valid.
      try {
        const actor = await authenticateBearer(raw);
        await rateLimiter.refund('mcpOwnerBadAuthIp', ip, d.windowStart);
        return { auth: actor };
      } catch (error) {
        if (error instanceof OAuthError) return d.limited ? limited(d.retryAfterSec) : unauthorized(true);
        throw error;
      }
    }
    try {
      return { auth: await authenticateBearer(raw) };
    } catch (error) {
      if (error instanceof OAuthError) return unauthorized(true);
      throw error;
    }
  },
};

function limited(retryAfterSec: number): Response {
  return Response.json(
    { jsonrpc: '2.0', id: null, error: { code: -32029, message: 'Too many invalid requests. Try again later.' } },
    { status: 429, headers: { 'retry-after': String(retryAfterSec), 'cache-control': 'no-store' } },
  );
}

/**
 * The OWNER connector: the same MCP protocol layer as /api/mcp, behind an OAuth 2.1 Bearer token. Not in openapi.json
 * (JSON-RPC, like /api/mcp). 404 for every method while MCP_OWNER_ENABLED is not `true`.
 */
export async function POST(req: Request): Promise<Response> {
  if (!isOwnerConnectorEnabled()) return notFoundResponse();
  return handleMcpRequest(req, deps);
}

const other = async (req: Request): Promise<Response> => {
  if (!isOwnerConnectorEnabled()) return notFoundResponse();
  return handleMcpRequest(req, deps);
};
export async function OPTIONS(): Promise<Response> {
  if (!isOwnerConnectorEnabled()) return notFoundResponse();
  return new Response(null, { status: 204, headers: { allow: 'POST', 'cache-control': 'no-store' } });
}
export const GET = other;
export const DELETE = other;
export const PUT = other;
export const PATCH = other;
