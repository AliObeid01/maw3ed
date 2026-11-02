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
    for (const path of ['/', '/b/studio-nour', '/l/token', '/l/abc.def', '/l/abc.def.ghi', '/l/x.jsx', '/login'])
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

describe('proxy: Content-Security-Policy', () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { ...env };
  const restore = () => {
    for (const k of ['CSP_MODE', 'SENTRY_DSN', 'NEXT_PUBLIC_SENTRY_DSN']) {
      if (saved[k] === undefined) delete env[k];
      else env[k] = saved[k];
    }
  };
  const nonceOf = (csp: string | null) => /'nonce-([^']+)'/.exec(csp ?? '')?.[1];

  it('sets the same CSP (with a nonce) on the request headers Next reads and on the response', () => {
    delete env.CSP_MODE;
    const res = run('https://maw3ed.example/login');
    const csp = res.headers.get('content-security-policy');
    expect(nonceOf(csp)).toBeTruthy();
    // NextResponse.next({request}) exposes the forwarded request headers as x-middleware-request-*.
    expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonceOf(csp));
    expect(res.headers.get('x-middleware-request-x-maw3ed-path')).toBe('/login');
    restore();
  });

  it('uses a different nonce for every request', () => {
    const a = nonceOf(run('https://maw3ed.example/').headers.get('content-security-policy'));
    const b = nonceOf(run('https://maw3ed.example/').headers.get('content-security-policy'));
    expect(a).not.toBe(b);
  });

  it('adds the sentry ingest host from the DSN to connect-src', () => {
    env.NEXT_PUBLIC_SENTRY_DSN = 'https://abc@o1.ingest.de.sentry.io/1';
    try {
      const csp = run('https://maw3ed.example/').headers.get('content-security-policy');
      expect(csp).toContain("connect-src 'self' https://o1.ingest.de.sentry.io;");
    } finally {
      restore();
    }
  });

  it('treats an empty public DSN as absent and falls back to the server one; both empty gives no host', () => {
    try {
      env.NEXT_PUBLIC_SENTRY_DSN = '';
      env.SENTRY_DSN = 'https://abc@o2.ingest.de.sentry.io/1';
      expect(run('https://maw3ed.example/').headers.get('content-security-policy')).toContain(
        "connect-src 'self' https://o2.ingest.de.sentry.io;",
      );
      env.SENTRY_DSN = '';
      expect(run('https://maw3ed.example/').headers.get('content-security-policy')).toContain("connect-src 'self';");
    } finally {
      restore();
    }
  });

  it('CSP_MODE=report-only sends the report-only header, off sends none, invalid enforces', () => {
    try {
      env.CSP_MODE = 'report-only';
      let res = run('https://maw3ed.example/');
      expect(res.headers.get('content-security-policy')).toBeNull();
      expect(res.headers.get('content-security-policy-report-only')).toContain("default-src 'self'");
      env.CSP_MODE = 'off';
      res = run('https://maw3ed.example/');
      expect(res.headers.get('content-security-policy')).toBeNull();
      expect(res.headers.get('content-security-policy-report-only')).toBeNull();
      expect(res.headers.get('x-middleware-request-content-security-policy')).toBeNull();
      expect(res.headers.get('x-middleware-request-x-maw3ed-path')).toBe('/');
      env.CSP_MODE = 'banana';
      expect(run('https://maw3ed.example/').headers.get('content-security-policy')).toContain("default-src 'self'");
    } finally {
      restore();
    }
  });

  it('keeps the ?lang= redirect and cookie working', () => {
    const res = run('https://maw3ed.example/?lang=ar');
    expect(res.status).toBe(307);
    expect(res.cookies.get('locale')?.value).toBe('ar');
  });

  it('excludes API routes and Next internals from the proxy matcher', () => {
    const matches = getMiddlewareRouteMatcher(getMiddlewareMatchers(config.matcher, {}));
    expect(matches('/api/health', { headers: {} } as never, {} as never)).toBe(false);
    expect(matches('/_next/static/a.js', { headers: {} } as never, {} as never)).toBe(false);
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
