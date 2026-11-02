// Pure decision for the Sentry source map upload (F39). Used by next.config.ts and scripts/lib/productionEnv.mjs.
// Never returns, logs or throws a VALUE of a secret: only variable names and short reasons.

const VARS = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'];

const present = (v) => typeof v === 'string' && v.trim() !== '';
const trimmed = (v) => (typeof v === 'string' ? v.trim() : '');

/** The Sentry region API origin an EU/US organisation needs, taken from the DSN host (o123.ingest.de.sentry.io). */
export function sentryUrlFromDsn(dsn) {
  try {
    const host = new URL(trimmed(dsn)).hostname;
    const m = /\.ingest\.(us|de)\.sentry\.io$/.exec(host);
    return m ? `https://${m[1]}.sentry.io` : undefined;
  } catch {
    return undefined;
  }
}

/** An https origin (no path, query or credentials), or undefined. */
function httpsOrigin(value) {
  try {
    const raw = trimmed(value).replace(/\/+$/, '');
    const u = new URL(raw);
    return u.protocol === 'https:' && u.origin === raw ? u.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Decides whether this build uploads source maps.
 *
 * Upload only when ALL of SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT are present AND VERCEL_ENV is
 * "production" (build time). Anything else is inert. The API origin comes from SENTRY_URL when it is a valid
 * https origin, otherwise from the DSN region (EU DSN -> https://de.sentry.io), otherwise the SDK default.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ enabled: boolean, reason: string, warnings: string[], sentryUrl?: string, org?: string, project?: string, release?: string }}
 */
export function resolveSourcemapUpload(env) {
  const set = VARS.filter((name) => present(env[name]));
  const missing = VARS.filter((name) => !present(env[name]));
  const warnings = [];

  if (set.length === 0) return { enabled: false, reason: 'not-configured', warnings };
  if (missing.length > 0) {
    warnings.push(
      `Sentry source maps are half configured (set: ${set.join(', ')}; missing: ${missing.join(', ')}): ` +
        'nothing is uploaded and stack traces stay minified. Set all three or none.',
    );
    return { enabled: false, reason: 'partial', warnings };
  }
  if (env.VERCEL_ENV !== 'production') return { enabled: false, reason: 'not-production', warnings };

  let sentryUrl;
  if (present(env.SENTRY_URL)) {
    sentryUrl = httpsOrigin(env.SENTRY_URL);
    if (!sentryUrl) warnings.push('SENTRY_URL is not a valid https origin and is ignored; the region is taken from the DSN.');
  }
  sentryUrl ??= sentryUrlFromDsn(env.NEXT_PUBLIC_SENTRY_DSN) ?? sentryUrlFromDsn(env.SENTRY_DSN);

  return {
    enabled: true,
    reason: 'enabled',
    warnings,
    ...(sentryUrl ? { sentryUrl } : {}),
    org: trimmed(env.SENTRY_ORG),
    project: trimmed(env.SENTRY_PROJECT),
    ...(present(env.VERCEL_GIT_COMMIT_SHA) ? { release: trimmed(env.VERCEL_GIT_COMMIT_SHA) } : {}),
  };
}

/** One safe line for a failed upload: the message with every secret value removed, capped in length. */
export function describeUploadFailure(error, secrets = []) {
  let text = error instanceof Error ? error.message : String(error ?? '');
  for (const secret of secrets) {
    if (present(secret) && trimmed(secret).length >= 4) text = text.split(trimmed(secret)).join('[hidden]');
  }
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}

/**
 * The Sentry build options for next.config.ts. Disabled: `sourcemaps.disable` (no maps generated, nothing uploaded).
 * Enabled: upload, delete the maps afterwards, never fail the build (errorHandler only warns).
 * `warn` receives the line to print.
 */
export function sourcemapBuildOptions(env, warn = console.warn) {
  const decision = resolveSourcemapUpload(env);
  for (const w of decision.warnings) warn(`Warning: ${w}`);
  if (!decision.enabled) return { sourcemaps: { disable: true }, release: { create: false, finalize: false } };
  const secrets = [env.SENTRY_AUTH_TOKEN];
  return {
    authToken: trimmed(env.SENTRY_AUTH_TOKEN),
    org: decision.org,
    project: decision.project,
    ...(decision.sentryUrl ? { sentryUrl: decision.sentryUrl } : {}),
    sourcemaps: { deleteSourcemapsAfterUpload: true },
    release: { ...(decision.release ? { name: decision.release } : {}), create: false, finalize: false },
    errorHandler: (error) => {
      warn(
        'Warning: Sentry source map upload failed. The build continues; stack traces stay minified. ' +
          `Check the three SENTRY_ variables and the token scope (values are never printed). Detail: ${describeUploadFailure(error, secrets)}`,
      );
    },
  };
}
