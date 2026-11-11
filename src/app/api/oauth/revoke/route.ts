import { oauthRoute, readForm } from '@/server/http/oauthRoute';
import { revoke } from '@/server/services/oauth';

export const dynamic = 'force-dynamic';

/** RFC 7009. Always 200 with an empty body, whether or not the token was known. */
const handler = oauthRoute({ policy: 'oauthRevokeIp', path: '/api/oauth/revoke' }, async (req) => {
  await revoke((await readForm(req)).token);
  return new Response(null, { status: 200, headers: { 'cache-control': 'no-store', pragma: 'no-cache' } });
});
export const POST = handler;
export const GET = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
