import { authorizationServerMetadata } from '@/server/mcp/ownerConfig';
import { wellKnown } from '@/server/http/oauthRoute';

export const dynamic = 'force-dynamic';

/** RFC 8414 metadata. Issuer and endpoints come from APP_URL, never from the request. 404 while MCP_OWNER_ENABLED is off. */
const handler = wellKnown(() => authorizationServerMetadata());
export const GET = handler;
export const HEAD = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
