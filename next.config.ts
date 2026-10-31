import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The e2e dev server (E2E_FAKE_SESSION) hides the dev badge: in RTL it covers the mirrored More tab.
  ...(process.env.E2E_FAKE_SESSION ? { devIndicators: false as const } : {}),
  poweredByHeader: false,
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

export default withNextIntl(nextConfig);
