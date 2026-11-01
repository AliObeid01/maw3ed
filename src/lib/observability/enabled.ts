/**
 * Whether error reporting is on. Tiny and dependency-free on purpose: it is the only observability code in the
 * first-load bundle (the rest, including the scrubber, loads together with the SDK, and only when reporting is on).
 */
/** What decides whether reporting is on. All optional: with no DSN the whole feature is inert. */
export interface ObservabilityEnv {
  /** `SENTRY_DSN` (server) or `NEXT_PUBLIC_SENTRY_DSN` (client). A public identifier, not a secret. */
  dsn?: string;
  /** `VERCEL_ENV`: only 'production' reports. Previews and local never do. */
  vercelEnv?: string;
  /** `VERCEL_GIT_COMMIT_SHA`. */
  release?: string;
}

export type SentryConfig =
  | { enabled: false; reason: 'no-dsn' | 'invalid-dsn' | 'not-production' }
  | { enabled: true; dsn: string; environment: 'production'; release?: string };

export function resolveSentryConfig(env: ObservabilityEnv): SentryConfig {
  const dsn = env.dsn?.trim();
  if (!dsn) return { enabled: false, reason: 'no-dsn' };
  try {
    if (new URL(dsn).protocol !== 'https:') return { enabled: false, reason: 'invalid-dsn' };
  } catch {
    return { enabled: false, reason: 'invalid-dsn' };
  }
  if (env.vercelEnv !== 'production') return { enabled: false, reason: 'not-production' };
  const release = env.release?.trim();
  return { enabled: true, dsn, environment: 'production', ...(release ? { release } : {}) };
}

/** Server-side inputs (`SENTRY_DSN`, `VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA`). */
export function serverObservabilityEnv(
  source: Record<string, string | undefined> = process.env,
): ObservabilityEnv {
  return {
    dsn: source.SENTRY_DSN,
    vercelEnv: source.VERCEL_ENV,
    release: source.VERCEL_GIT_COMMIT_SHA,
  };
}
