import { NextResponse, type NextRequest } from 'next/server';
import { isLocale, LOCALE_COOKIE, PATH_HEADER } from '@/i18n/config';

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
    return NextResponse.next({ request: { headers: forwarded } });
  }

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
