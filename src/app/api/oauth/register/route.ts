import { oauthJson, oauthRoute, readJsonBody } from '@/server/http/oauthRoute';
import { registerClient } from '@/server/services/oauth';

export const dynamic = 'force-dynamic';

/** RFC 7591 dynamic client registration (public clients only). Not in openapi.json: see docs/MCP_OWNER.md. */
const handler = oauthRoute({ policy: 'oauthRegisterIp', path: '/api/oauth/register' }, async (req) =>
  oauthJson(await registerClient(await readJsonBody(req)), 201),
);
export const POST = handler;
export const GET = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
