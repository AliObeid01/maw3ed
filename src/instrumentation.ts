import type { Instrumentation } from 'next';

/**
 * Server error monitoring (NFR-11). Errors only; see docs/ARCHITECTURE.md ("Error monitoring").
 * Inert unless SENTRY_DSN is set in a Vercel Production deployment: then nothing is imported or sent.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { initServerSentry } = await import('@/server/observability/init');
  await initServerSentry(process.env, () => import('@sentry/nextjs'));
}

/** Render, route and action errors Next.js catches itself (the ones `withRoute` does not already map). */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const { isActive } = await import('@/server/observability/report');
  if (!isActive()) return;
  const sdk = await import('@sentry/nextjs');
  sdk.withScope((scope) => {
    // The templated route (`/l/[token]`), never `request.path`.
    scope.setTags({ route: context.routePath, method: request.method });
    sdk.captureRequestError(error, request, context);
  });
};
