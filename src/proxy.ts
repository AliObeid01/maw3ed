import { NextResponse, type NextRequest } from 'next/server';
import { isLocale, LOCALE_COOKIE } from '@/i18n/config';

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * `?lang=en|ar` on any page request sets the `locale` cookie and redirects to the same URL without the
 * parameter, so shared links can pick a language and the address bar stays clean. Anything else passes through.
 */
export function proxy(request: NextRequest) {
  const lang = request.nextUrl.searchParams.get('lang') ?? undefined;
  if (!isLocale(lang)) return NextResponse.next();

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
  // Pages only: not the API, Next internals, or anything with a file extension (images, fonts, favicon).
  matcher: ['/((?!api/|_next/|.*\\..*).*)'],
};
