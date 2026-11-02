// Build-wide guard (F39): a stalled Sentry source map upload inside `next build` must not hang a deploy until
// Vercel's own limit. Pure helpers, unit-tested.
export const DEFAULT_BUILD_TIMEOUT_MINUTES = 25;
export const MIN_BUILD_TIMEOUT_MINUTES = 5;
export const MAX_BUILD_TIMEOUT_MINUTES = 40;

/** Minutes from BUILD_TIMEOUT_MINUTES (optional, never required), clamped to 5..40; garbage gives the default. */
export function buildTimeoutMinutes(env) {
  const raw = typeof env.BUILD_TIMEOUT_MINUTES === 'string' ? env.BUILD_TIMEOUT_MINUTES.trim() : '';
  if (raw === '') return DEFAULT_BUILD_TIMEOUT_MINUTES;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_BUILD_TIMEOUT_MINUTES;
  return Math.min(MAX_BUILD_TIMEOUT_MINUTES, Math.max(MIN_BUILD_TIMEOUT_MINUTES, Math.round(n)));
}

export function buildTimeoutMessage(minutes) {
  return (
    `Build timed out after ${minutes} minutes, possibly the Sentry source map upload: ` +
    'unset SENTRY_AUTH_TOKEN to disable it (or set BUILD_TIMEOUT_MINUTES, 5 to 40).'
  );
}
