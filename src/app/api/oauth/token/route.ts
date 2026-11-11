import { oauthJson, oauthRoute, readForm } from '@/server/http/oauthRoute';
import { token } from '@/server/services/oauth';

export const dynamic = 'force-dynamic';

/** The token endpoint: authorization_code (PKCE S256, single use) and refresh_token (rotation, reuse detection). */
const handler = oauthRoute({ policy: 'oauthTokenIp', path: '/api/oauth/token' }, async (req) =>
  oauthJson(await token(await readForm(req))),
);
export const POST = handler;
export const GET = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
