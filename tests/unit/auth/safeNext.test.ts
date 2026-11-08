import { describe, expect, it } from 'vitest';
import { loginHref, safeNext, safePlan } from '@/lib/auth/safeNext';

describe('safeNext (open-redirect guard for /login?next=)', () => {
  it('accepts same-origin dashboard paths under /app/', () => {
    for (const ok of [
      '/app/checkout',
      '/app/checkout?plan=pro',
      '/app/settings',
      '/app/appointments/abc_123-x',
    ])
      expect(safeNext(ok)).toBe(ok);
  });

  it('rejects open-redirect payloads and anything outside /app/', () => {
    const bad: unknown[] = [
      '//evil.com',
      '//evil.com/app/x',
      '/\\evil.com',
      '/app/\\evil.com',
      '\\\\evil.com',
      'https://evil.com',
      'https://evil.com/app/checkout',
      'http://x',
      'javascript:alert(1)',
      'data:text/html,hi',
      '/%2F%2Fevil.com',
      '/app/%2F%2Fevil.com',
      '/%5Cevil.com',
      '/app/checkout%0d%0aSet-Cookie:x=1',
      '/app/check out',
      ' /app/checkout',
      '/app/checkout ',
      '/app/checkout\t',
      '/app/checkout\n',
      '/app/\u0000x',
      '/app/‮x',
      '/app/../login',
      '/app/./x',
      '/app',
      '/apple/x',
      '/api/me',
      '/login',
      '/',
      '',
      'app/checkout',
      '/app/checkout#//evil.com',
      '/app/x?next=//evil.com',
      '/app/x?a=<script>',
      '/app/' + 'a'.repeat(300),
      null,
      undefined,
      42,
      {},
    ];
    for (const value of bad) expect(safeNext(value), String(value)).toBeNull();
  });

  it('takes only the first value when the parameter is repeated', () => {
    expect(safeNext(['/app/checkout?plan=pro', '//evil.com'])).toBe('/app/checkout?plan=pro');
    expect(safeNext(['//evil.com', '/app/checkout'])).toBeNull();
  });
});

describe('safePlan', () => {
  it('accepts only the whitelisted value "pro"', () => {
    expect(safePlan('pro')).toBe('pro');
    for (const v of ['PRO', 'Pro', 'free', 'pro ', 'pro,free', '', null, undefined, 1])
      expect(safePlan(v), String(v)).toBeUndefined();
  });
});

describe('loginHref', () => {
  it('adds an encoded safe next, and nothing when unsafe', () => {
    expect(loginHref('/app/checkout?plan=pro')).toBe('/login?next=%2Fapp%2Fcheckout%3Fplan%3Dpro');
    expect(loginHref('//evil.com')).toBe('/login');
    expect(loginHref(undefined)).toBe('/login');
  });
});
