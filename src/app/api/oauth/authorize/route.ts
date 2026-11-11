import { resolveSession } from '@/server/http/auth';
import { oauthRoute, readForm } from '@/server/http/oauthRoute';
import { siteOrigin } from '@/server/mcp/ownerConfig';
import { decide, OAuthError } from '@/server/services/oauth';

export const dynamic = 'force-dynamic';

const see = (path: string) =>
  new Response(null, {
    status: 303,
    headers: { location: path, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  });

/**
 * The consent decision (Allow / Cancel), posted by the page /oauth/authorize. CSRF defence, three layers:
 * the SameSite=Lax session cookie (not sent on a cross-site POST), a REQUIRED same-origin `Origin` header, and the
 * signed one-time consent token in the form (bound to this user, business and every request parameter).
 */
const handler = oauthRoute({ policy: 'oauthAuthorizeIp', path: '/api/oauth/authorize' }, async (req) => {
  const origin = req.headers.get('origin');
  let originOk = false;
  try {
    originOk = origin !== null && new URL(origin).origin === siteOrigin();
  } catch {
    /* "null" and garbage origins are refused below */
  }
  if (!originOk) throw new OAuthError('access_denied', 'Cross-origin request blocked.', 403);

  let session;
  try {
    session = await resolveSession(req);
  } catch {
    return see('/login');
  }
  const form = await readForm(req);
  const result = await decide(session, { consent: form.consent ?? '', decision: form.decision ?? '' });
  if (result.kind === 'redirect')
    return new Response(null, {
      status: 302,
      headers: { location: result.location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
    });
  return see(`/oauth/authorize?status=${result.kind === 'not_owner' ? 'not_owner' : 'expired'}`);
});
export const POST = handler;
export const GET = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
