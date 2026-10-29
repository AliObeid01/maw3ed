import { NextRequest } from 'next/server';
import * as staticInfo from 'next/dist/build/analysis/get-page-static-info.js';
import { getMiddlewareRouteMatcher } from 'next/dist/shared/lib/router/utils/middleware-route-matcher.js';
import { describe, expect, it } from 'vitest';
import { pickLocale } from '@/i18n/config';
import { config, proxy } from '@/proxy';

// Not in Next's published types, but it is the exact function the build uses to compile `config.matcher`.
const { getMiddlewareMatchers } = staticInfo as unknown as {
  getMiddlewareMatchers: (matchers: string[], config: object) => never;
};
const run = (url: string) => proxy(new NextRequest(url));

describe('proxy: ?lang=', () => {
  it('sets the locale cookie and redirects to the same URL without the parameter', () => {
    const res = run('https://maw3ed.example/b/studio-nour?service=s1&lang=ar');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://maw3ed.example/b/studio-nour?service=s1');
    const cookie = res.cookies.get('locale')!;
    expect(cookie).toMatchObject({ value: 'ar', path: '/', sameSite: 'lax', secure: true });
    expect(cookie.maxAge).toBe(31_536_000);
  });

  it('does not mark the cookie Secure on plain http (local dev)', () => {
    const res = run('http://localhost:3000/b/x?lang=en');
    expect(res.cookies.get('locale')).toMatchObject({ value: 'en', secure: false });
    expect(res.headers.get('location')).toBe('http://localhost:3000/b/x');
  });

  it('leaves unsupported or absent values alone', () => {
    for (const url of ['http://localhost:3000/b/x?lang=fr', 'http://localhost:3000/b/x']) {
      const res = run(url);
      expect(res.headers.get('location')).toBeNull();
      expect(res.cookies.get('locale')).toBeUndefined();
    }
  });

  it('sets the cookie on a signed link token that contains a dot', () => {
    const res = run('https://maw3ed.example/l/abc_DEF-123.sig_456-xyz?lang=ar');
    expect(res.headers.get('location')).toBe('https://maw3ed.example/l/abc_DEF-123.sig_456-xyz');
    expect(res.cookies.get('locale')).toMatchObject({ value: 'ar' });
  });

  // Compiled exactly the way Next compiles a middleware matcher (same functions the build and the server use).
  const matches = getMiddlewareRouteMatcher(getMiddlewareMatchers(config.matcher, {}));
  const hit = (path: string) => matches(path, { headers: {} } as never, {} as never);

  it('with the real Next matcher: runs for pages and dotted tokens, not for the API, internals or static files', () => {
    for (const path of [
      '/',
      '/b/studio-nour',
      '/l/token',
      '/l/abc.def',
      '/l/abc.def.ghi',
      '/l/x.jsx',
      '/login',
    ])
      expect(hit(path), path).toBe(true);
    for (const path of [
      '/api/public/x',
      '/_next/static/chunk.js',
      '/_next/image',
      '/favicon.ico',
      '/logo.svg',
      '/fonts/a.woff2',
      '/robots.txt',
      '/manifest.webmanifest',
      '/img/a.PNG'.toLowerCase(),
    ])
      expect(hit(path), path).toBe(false);
  });
});

describe('pickLocale', () => {
  it('prefers the visitor cookie, then the business hint, then English', () => {
    expect(pickLocale('en', 'ar')).toBe('en');
    expect(pickLocale('ar', 'en')).toBe('ar');
    expect(pickLocale(undefined, 'ar')).toBe('ar');
    expect(pickLocale('fr', 'ar')).toBe('ar');
    expect(pickLocale(undefined, undefined)).toBe('en');
    expect(pickLocale('xx', 'yy')).toBe('en');
  });
});
