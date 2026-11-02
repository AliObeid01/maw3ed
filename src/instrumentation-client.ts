// Must stay the FIRST import: it configures zod before any schema is built (see the file for why).
import '@/lib/security/zodJitless';
import { initClientSentry } from '@/lib/observability/clientInit';

/**
 * Browser error monitoring (NFR-11). Errors only. Inert unless NEXT_PUBLIC_SENTRY_DSN was set at build time
 * for a Vercel Production deployment (next.config.ts bakes in NEXT_PUBLIC_SENTRY_ENV / _RELEASE): then no SDK
 * code is fetched and no listener is added. When on, the SDK loads as its own chunk after startup, so it is
 * never part of the first-load JavaScript.
 */
initClientSentry({
  env: {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    vercelEnv: process.env.NEXT_PUBLIC_SENTRY_ENV,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  },
  loadSdk: () => import('@/lib/observability/clientSdk'),
  win: window,
  now: () => Date.now(),
});
