import { resolveSession } from '@/server/http/auth';
import { oauthRoute, readForm } from '@/server/http/oauthRoute';
import { siteOrigin } from '@/server/mcp/ownerConfig';
import { decide } from '@/server/services/oauth';

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
/**
 * Same-origin proof for a form POST. A real Origin decides on its own (ours: yes, any other: no, whatever
 * Sec-Fetch-Site says). Browsers may send NO Origin or the literal "null" for a same-origin form POST (for example
 * under a no-referrer policy); then the browser-set Sec-Fetch-Site header must say "same-origin". Anything else
 * (missing, cross-site, same-site, none) is refused.
 */
export function sameOriginPost(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (origin !== null && origin !== 'null') {
    try {
      return new URL(origin).origin === siteOrigin();
    } catch {
      return false;
    }
  }
  return req.headers.get('sec-fetch-site') === 'same-origin';
}

const handler = oauthRoute({ policy: 'oauthAuthorizeIp', path: '/api/oauth/authorize' }, async (req) => {
  if (!sameOriginPost(req)) return see('/oauth/authorize?status=blocked');

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
