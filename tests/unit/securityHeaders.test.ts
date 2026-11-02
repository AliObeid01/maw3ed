import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';

type Rule = { source: string; headers: { key: string; value: string }[] };
type Resolved = { headers: () => Promise<Rule[]>; poweredByHeader?: boolean };

// The value a browser sees: Next applies matching rules in order, a later rule overriding an earlier one.
function effective(rules: Rule[], path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rules) {
    const src = r.source.replace(/\/:path\*$/, '(?:/.*)?').replace(/\/:path\(\.\*\)$/, '(?:/.*)?');
    if (new RegExp(`^${src}$`).test(path)) for (const h of r.headers) out[h.key] = h.value;
  }
  return out;
}

describe('next.config headers()', async () => {
  const resolved = await (nextConfig as unknown as (phase: string, ctx: object) => Promise<Resolved>)(
    'phase-production-build',
    { defaultConfig: {} },
  );
  const rules = await resolved.headers();

  it('turns off X-Powered-By', () => {
    expect(resolved.poweredByHeader).toBe(false);
  });

  it('sets the static security headers on every route and no HSTS', () => {
    for (const path of ['/', '/login', '/b/studio-nour', '/api/health', '/dashboard/today']) {
      const h = effective(rules, path);
      expect(h['X-Content-Type-Options'], path).toBe('nosniff');
      expect(h['X-Frame-Options'], path).toBe('DENY');
      expect(h['Referrer-Policy'], path).toBe('strict-origin-when-cross-origin');
      expect(h['Permissions-Policy'], path).toBe(
        'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
      );
      expect(h['Cross-Origin-Opener-Policy'], path).toBe('same-origin');
      expect(h['Strict-Transport-Security'], path).toBeUndefined();
    }
  });

  it('keeps no-referrer (and no-store) winning on the token routes', () => {
    for (const path of ['/invite/x', '/l/a.b', '/o/x', '/pay/x', '/verify-email/x', '/reset-password/x']) {
      expect(effective(rules, path)['Referrer-Policy'], path).toBe('no-referrer');
    }
    expect(effective(rules, '/l/a.b')['Cache-Control']).toBe('no-store');
  });

  it('gives API routes a locked-down CSP and pages none (the proxy sets theirs)', () => {
    expect(effective(rules, '/api/health')['Content-Security-Policy']).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(effective(rules, '/login')['Content-Security-Policy']).toBeUndefined();
  });
});
