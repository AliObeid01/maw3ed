import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs/config';
import createNextIntlPlugin from 'next-intl/plugin';
import { sourcemapBuildOptions } from './scripts/lib/sourcemapUpload.mjs';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The e2e dev server (E2E_FAKE_SESSION) hides the dev badge: in RTL it covers the mirrored More tab.
  ...(process.env.E2E_FAKE_SESSION ? { devIndicators: false as const } : {}),
  poweredByHeader: false,
  // Error monitoring (src/instrumentation-client.ts) can only see build-time values: the deployment type and the commit.
  // Both are public by nature. Without NEXT_PUBLIC_SENTRY_DSN the browser code is inert anyway.
  env: {
    NEXT_PUBLIC_SENTRY_ENV: process.env.VERCEL_ENV ?? '',
    NEXT_PUBLIC_SENTRY_RELEASE: process.env.VERCEL_GIT_COMMIT_SHA ?? '',
  },
  // PR-13: /pricing was removed; its content lives on /for-business#plans. ONE permanent redirect keeps old links and
  // bookmarks working (308 + Location with the hash; /pricing/ and /pricing?x=1 end there too; tests/e2e/forBusinessPlans.spec.ts checks it).
  async redirects() {
    return [{ source: '/pricing', destination: '/for-business#plans', permanent: true }];
  },
  async headers() {
    return [
      {
        // Every route. Listed FIRST: the more specific token rules below come later and override Referrer-Policy.
        // No HSTS here: Vercel's custom domain already sends Strict-Transport-Security.
        // The page CSP (nonce) is per request, so it is set in src/proxy.ts, not here.
        // X-Frame-Options DENY is deliberate: the booking page cannot be embedded in another site's iframe.
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
          },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
      {
        // The proxy does not run for the API (JSON only): a static, fully locked-down policy.
        source: '/api/:path*',
        headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'" }],
      },
      {
        // The invite token is a bearer secret in the URL: never send it in a Referer header.
        source: '/invite/:path*',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
      {
        // Verify-email and reset-password links carry a one-time token in the URL: no Referer, never cached.
        source: '/verify-email/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      {
        // The activation link carries a one-time bearer token: no Referer, never cached.
        source: '/activate/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      {
        source: '/reset-password/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      {
        // The link token is a bearer secret (it can cancel an appointment): never send it in a Referer header.
        source: '/l/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          // The page is per-token and per-moment (free vs late cancellation): never serve it from a shared cache.
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      {
        // The pay token is a bearer secret (it pays for a held slot) and the page is per-moment (countdown).
        source: '/pay/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      {
        // The offer token is a bearer secret (it books a slot) and the page is per-moment (countdown).
        source: '/o/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};

// Errors only (docs/ARCHITECTURE.md, Error monitoring). Build-time: no release, no telemetry, no tunnel, and the SDK's
// tracing, replay and debug-logging code is tree-shaken out of the bundles.
// Source maps (F39): INERT unless SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT are all set and VERCEL_ENV is
// production at build time (scripts/lib/sourcemapUpload.mjs). When active they are uploaded and deleted from the
// deployment, a failed upload only warns, and scripts/clean-sourcemaps.mjs removes anything that is left.
const withSentry = withSentryConfig(withNextIntl(nextConfig), {
  silent: true,
  telemetry: false,
  ...sourcemapBuildOptions(process.env),
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeTracing: true,
    excludeReplayIframe: true,
    excludeReplayShadowDom: true,
    excludeReplayWorker: true,
  },
});

// withSentryConfig turns on the experimental clientTraceMetadata (trace meta tags for performance tracing). We run
// errors only, so remove it and keep the rest of the wrapped config (headers() included) untouched.
export default async function config(...args: unknown[]) {
  const resolved = (
    typeof withSentry === 'function'
      ? await (withSentry as (...a: unknown[]) => unknown)(...args)
      : withSentry
  ) as NextConfig;
  if (resolved.experimental) delete resolved.experimental.clientTraceMetadata;
  return resolved;
}
