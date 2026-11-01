// Pure checks for a production build. Returns short problem strings; NEVER includes values.
// `errors` block the build; `warnings` are printed but do not.
const REQUIRED = [
  'DATABASE_URL',
  'DIRECT_URL',
  'APP_URL',
  'NEXT_PUBLIC_APP_URL',
  'LINK_SECRET',
  'CRON_SECRET',
  'EMAIL_PROVIDER',
  'RESEND_API_KEY',
  'EMAIL_FROM',
];
const SECRETS = ['LINK_SECRET', 'CRON_SECRET'];
const FORBIDDEN = ['ALLOW_SEED', 'ALLOW_SEED_REMOTE', 'E2E_FAKE_SESSION'];

const present = (v) => typeof v === 'string' && v.trim() !== '';
const trimmed = (v) => (typeof v === 'string' ? v.trim() : '');

/** `https://host` with no path, query, fragment or credentials. A trailing slash is tolerated (the app strips it). */
function httpsOrigin(value) {
  try {
    const u = new URL(trimmed(value).replace(/\/+$/, ''));
    return u.protocol === 'https:' && u.origin === trimmed(value).replace(/\/+$/, '') ? u.origin : null;
  } catch {
    return null;
  }
}

const hostOf = (value) => {
  try {
    return new URL(trimmed(value)).hostname;
  } catch {
    return null;
  }
};

/** Whether a Vercel build may apply database migrations: production deploys only. */
export function shouldMigrate(env) {
  return env.VERCEL_ENV === 'production';
}

export function checkProductionEnv(env) {
  const errors = [];
  const warnings = [];
  for (const name of REQUIRED) if (!present(env[name])) errors.push(`${name} is missing`);
  for (const name of SECRETS) {
    if (present(env[name]) && trimmed(env[name]).length < 32) errors.push(`${name} must be at least 32 characters`);
  }
  const secrets = SECRETS.map((n) => trimmed(env[n])).filter(Boolean);
  if (new Set(secrets).size !== secrets.length) errors.push('LINK_SECRET and CRON_SECRET must be different');

  for (const name of ['APP_URL', 'NEXT_PUBLIC_APP_URL']) {
    if (present(env[name]) && !httpsOrigin(env[name])) {
      errors.push(`${name} must be an https origin with no path, query or credentials (for example https://example.com)`);
    }
  }
  if (httpsOrigin(env.APP_URL) && httpsOrigin(env.NEXT_PUBLIC_APP_URL) && httpsOrigin(env.APP_URL) !== httpsOrigin(env.NEXT_PUBLIC_APP_URL)) {
    errors.push('APP_URL and NEXT_PUBLIC_APP_URL must be the same');
  }
  if (present(env.EMAIL_PROVIDER) && trimmed(env.EMAIL_PROVIDER) !== 'resend') errors.push('EMAIL_PROVIDER must be "resend" in production');

  if (present(env.DATABASE_URL) && present(env.DIRECT_URL)) {
    if (trimmed(env.DATABASE_URL) === trimmed(env.DIRECT_URL)) errors.push('DATABASE_URL and DIRECT_URL must be different (pooled vs direct)');
  }
  if (present(env.DIRECT_URL) && /-pooler\./.test(trimmed(env.DIRECT_URL))) errors.push('DIRECT_URL must be the direct (non-pooled) connection string: migrations break through a pooler');
  if (present(env.DATABASE_URL) && !/-pooler\./.test(trimmed(env.DATABASE_URL))) warnings.push('DATABASE_URL does not look like a pooled Neon string (host without -pooler): fine for another provider, otherwise use the pooled string');

  if (present(env.EXPECTED_DB_HOST)) {
    const expected = trimmed(env.EXPECTED_DB_HOST).replace(/-pooler(?=\.)/, '');
    for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
      const host = hostOf(env[name]);
      if (host && host.replace(/-pooler(?=\.)/, '') !== expected) errors.push(`${name} does not point at EXPECTED_DB_HOST (wrong database for Production?)`);
    }
  } else {
    warnings.push('EXPECTED_DB_HOST is not set: set it to the production Neon endpoint host so a dev connection string can never be deployed to Production');
  }
  // Error monitoring is optional (the code is inert without a DSN): only an informational note, never an error.
  const serverDsn = present(env.SENTRY_DSN);
  const clientDsn = present(env.NEXT_PUBLIC_SENTRY_DSN);
  if (!serverDsn && !clientDsn) warnings.push('Sentry is not configured (SENTRY_DSN and NEXT_PUBLIC_SENTRY_DSN are unset): errors are logged but not reported. Optional.');
  else if (serverDsn !== clientDsn) warnings.push(`Sentry is half configured: set both SENTRY_DSN and NEXT_PUBLIC_SENTRY_DSN (${serverDsn ? 'browser' : 'server'} errors will not be reported).`);
  for (const name of FORBIDDEN) if (present(env[name])) errors.push(`${name} must not be set in production`);
  return { errors, warnings };
}
