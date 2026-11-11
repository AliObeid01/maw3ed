import { describe, expect, it } from 'vitest';
import nextConfig from '../../../next.config';

type Rule = { source: string; headers: { key: string; value: string }[] };

describe('consent page headers', async () => {
  const resolved = await (nextConfig as unknown as (p: string, c: object) => Promise<{ headers: () => Promise<Rule[]> }>)(
    'phase-production-build',
    { defaultConfig: {} },
  );
  const rules = await resolved.headers();
  const effective = (path: string) => {
    const out: Record<string, string> = {};
    for (const r of rules) {
      const src = r.source.replace(/\/:path\*$/, '(?:/.*)?');
      if (new RegExp(`^${src}$`).test(path)) for (const h of r.headers) out[h.key] = h.value;
    }
    return out;
  };

  it('/oauth/authorize sends Referrer-Policy same-origin (no-referrer would make the form POST carry Origin: null) and is never cached', () => {
    const h = effective('/oauth/authorize');
    expect(h['Referrer-Policy']).toBe('same-origin');
    expect(h['Cache-Control']).toBe('no-store');
    expect(h['X-Frame-Options']).toBe('DENY');
  });
});
