import { NextResponse, type NextRequest } from 'next/server';
import { isLocale, LOCALE_COOKIE, PATH_HEADER } from '@/i18n/config';
import { buildCsp, generateNonce, resolveCspMode, sentryHostFromDsn } from '@/lib/security/csp';

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * `?lang=en|ar` on any page request sets the `locale` cookie and redirects to the same URL without the
 * parameter, so shared links can pick a language and the address bar stays clean. Anything else passes through.
 */
export function proxy(request: NextRequest) {
  const lang = request.nextUrl.searchParams.get('lang') ?? undefined;
  if (!isLocale(lang)) {
    // Tell the server which page this is (never logged: it may carry a signed token) so the business's
    // language can be resolved before the first render.
    const forwarded = new Headers(request.headers);
    forwarded.set(PATH_HEADER, request.nextUrl.pathname);

    // Per-request CSP nonce. Read at request time (CSP_MODE is the owner's kill switch, no rebuild needed).
    // Next reads the nonce from the REQUEST header and stamps it on its own inline scripts; the same policy goes on the response.
    const mode = resolveCspMode(process.env.CSP_MODE);
    if (mode === 'off') return NextResponse.next({ request: { headers: forwarded } });
    const nonce = generateNonce();
    const csp = buildCsp({
      nonce,
      // `||` not `??`: an empty variable (.env.example ships `NEXT_PUBLIC_SENTRY_DSN=`) counts as absent.
      // NEXT_PUBLIC_ values are inlined at BUILD time, so changing the DSN needs a redeploy (rebuild).
      sentryHost: sentryHostFromDsn(process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN),
      isProd: process.env.NODE_ENV === 'production',
    });
    const header = mode === 'report-only' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
    forwarded.set('x-nonce', nonce);
    forwarded.set(header, csp);
    const response = NextResponse.next({ request: { headers: forwarded } });
    response.headers.set(header, csp);
    return response;
  }

  // The `?lang=` redirect is bodyless, so it intentionally carries no CSP (the static headers from next.config.ts still apply).
  const url = request.nextUrl.clone();
  url.searchParams.delete('lang');
  const response = NextResponse.redirect(url);
  response.cookies.set(LOCALE_COOKIE, lang, {
    path: '/',
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
    maxAge: ONE_YEAR,
  });
  return response;
}

export const config = {
  // Pages only: not the API, Next internals, or static files. Static files are an explicit extension list, NOT
  // "any dot": signed link tokens are `<base64url>.<base64url>`, so /l/<token> contains a dot and must match.
  // (`[.]` instead of an escaped dot: Next's matcher compiler drops the backslash.)
  matcher: [
    '/((?!api/|_next/|.*[.](?:svg|png|jpe?g|gif|webp|ico|css|js|map|txt|woff2?|json|xml|webmanifest)$).*)',
  ],
};
