import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs/config';
import createNextIntlPlugin from 'next-intl/plugin';

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
  async headers() {
    return [
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

// Errors only (docs/ARCHITECTURE.md, Error monitoring). Build-time: no source map upload, no release, no telemetry,
// no tunnel, and the SDK's tracing, replay and debug-logging code is tree-shaken out of the bundles.
const withSentry = withSentryConfig(withNextIntl(nextConfig), {
  silent: true,
  telemetry: false,
  sourcemaps: { disable: true },
  release: { create: false, finalize: false },
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
