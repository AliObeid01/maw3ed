import { describe, expect, it } from 'vitest';
import { buildCsp, generateNonce, resolveCspMode, sentryHostFromDsn } from '@/lib/security/csp';

const directives = (csp: string) =>
  Object.fromEntries(
    csp.split(';').map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name, values];
    }),
  );

describe('buildCsp', () => {
  const prod = directives(buildCsp({ nonce: 'abc123==', sentryHost: undefined, isProd: true }));

  it('sets every fixed directive', () => {
    expect(prod['default-src']).toEqual(["'self'"]);
    expect(prod['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
    expect(prod['img-src']).toEqual(["'self'", 'data:', 'blob:']);
    expect(prod['font-src']).toEqual(["'self'"]);
    expect(prod['connect-src']).toEqual(["'self'"]);
    expect(prod['object-src']).toEqual(["'none'"]);
    expect(prod['base-uri']).toEqual(["'self'"]);
    expect(prod['form-action']).toEqual(["'self'"]);
    expect(prod['frame-ancestors']).toEqual(["'none'"]);
  });

  it('embeds the nonce with strict-dynamic and no unsafe-inline / unsafe-eval in production scripts', () => {
    expect(prod['script-src']).toEqual(["'self'", "'nonce-abc123=='", "'strict-dynamic'"]);
  });

  it('allows unsafe-eval only outside production', () => {
    const dev = directives(buildCsp({ nonce: 'n', sentryHost: undefined, isProd: false }));
    expect(dev['script-src']).toContain("'unsafe-eval'");
    expect(dev['script-src']).not.toContain("'unsafe-inline'");
    expect(prod['script-src']).not.toContain("'unsafe-eval'");
  });

  it('adds upgrade-insecure-requests in production only', () => {
    expect('upgrade-insecure-requests' in prod).toBe(true);
    expect('upgrade-insecure-requests' in directives(buildCsp({ nonce: 'n', sentryHost: undefined, isProd: false }))).toBe(false);
  });

  it('adds exactly the sentry host to connect-src, as https, without wildcards', () => {
    const csp = buildCsp({ nonce: 'n', sentryHost: 'o1.ingest.de.sentry.io', isProd: true });
    expect(directives(csp)['connect-src']).toEqual(["'self'", 'https://o1.ingest.de.sentry.io']);
    expect(csp).not.toContain('*');
  });

  it('has no report-uri / report-to', () => {
    expect(buildCsp({ nonce: 'n', sentryHost: undefined, isProd: true })).not.toMatch(/report-/);
  });
});

describe('sentryHostFromDsn', () => {
  it('extracts the ingest host from a valid https DSN', () => {
    expect(sentryHostFromDsn('https://abc@o1.ingest.de.sentry.io/1')).toBe('o1.ingest.de.sentry.io');
    expect(sentryHostFromDsn('  https://abc@o123.ingest.de.sentry.io/45  ')).toBe('o123.ingest.de.sentry.io');
  });

  it('ignores empty, malformed, http and wildcard-ish values', () => {
    for (const bad of [undefined, '', '   ', 'not a url', 'http://abc@o1.ingest.de.sentry.io/1', 'ftp://x@h/1', 'https://*.sentry.io/1', "https://a@h.io; script-src */1"])
      expect(sentryHostFromDsn(bad), String(bad)).toBeUndefined();
  });
});

describe('resolveCspMode', () => {
  it('accepts the three modes and falls back to enforce', () => {
    expect(resolveCspMode('enforce')).toBe('enforce');
    expect(resolveCspMode('report-only')).toBe('report-only');
    expect(resolveCspMode('off')).toBe('off');
    expect(resolveCspMode(' OFF ')).toBe('off');
    for (const bad of [undefined, '', 'nope', 'true']) expect(resolveCspMode(bad)).toBe('enforce');
  });
});

describe('generateNonce', () => {
  it('is 128 bit base64 and differs per call', () => {
    const a = generateNonce();
    expect(Buffer.from(a, 'base64')).toHaveLength(16);
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(generateNonce()).not.toBe(a);
  });
});
