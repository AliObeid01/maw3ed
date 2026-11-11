import { protectedResourceMetadata } from '@/server/mcp/ownerConfig';
import { wellKnown } from '@/server/http/oauthRoute';

export const dynamic = 'force-dynamic';

/** RFC 9728 metadata for the owner MCP endpoint (the URL a 401 points to). 404 while MCP_OWNER_ENABLED is off. */
const handler = wellKnown(() => protectedResourceMetadata());
export const GET = handler;
export const HEAD = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
