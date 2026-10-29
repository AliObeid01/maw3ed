// Pure checks for a production build. Returns problems as short strings; never includes values.
const REQUIRED = [
  'DATABASE_URL',
  'DIRECT_URL',
  'APP_URL',
  'NEXT_PUBLIC_APP_URL',
  'SESSION_SECRET',
  'LINK_SECRET',
  'CRON_SECRET',
  'EMAIL_PROVIDER',
  'RESEND_API_KEY',
  'EMAIL_FROM',
];

const SECRETS = ['SESSION_SECRET', 'LINK_SECRET', 'CRON_SECRET'];

export function productionEnvProblems(env) {
  const problems = [];
  for (const name of REQUIRED) {
    if (!env[name] || !String(env[name]).trim()) problems.push(`${name} is missing`);
  }
  for (const name of SECRETS) {
    if (env[name] && String(env[name]).length < 32) problems.push(`${name} must be at least 32 characters`);
  }
  const secrets = SECRETS.map((n) => env[n]).filter(Boolean);
  if (new Set(secrets).size !== secrets.length) problems.push('SESSION_SECRET, LINK_SECRET and CRON_SECRET must all be different');
  for (const name of ['APP_URL', 'NEXT_PUBLIC_APP_URL']) {
    if (env[name] && !/^https:\/\/[^/\s]+$/.test(String(env[name]))) problems.push(`${name} must be an https origin without a path (for example https://example.com)`);
  }
  if (env.APP_URL && env.NEXT_PUBLIC_APP_URL && env.APP_URL !== env.NEXT_PUBLIC_APP_URL) problems.push('APP_URL and NEXT_PUBLIC_APP_URL must be the same');
  if (env.EMAIL_PROVIDER && env.EMAIL_PROVIDER !== 'resend') problems.push('EMAIL_PROVIDER must be "resend" in production');
  if (env.DATABASE_URL && !/-pooler\./.test(String(env.DATABASE_URL))) problems.push('DATABASE_URL should be the pooled Neon connection string (host contains -pooler)');
  if (env.DIRECT_URL && /-pooler\./.test(String(env.DIRECT_URL))) problems.push('DIRECT_URL must be the direct (non-pooled) connection string');
  if (env.ALLOW_SEED) problems.push('ALLOW_SEED must not be set in production');
  if (env.E2E_FAKE_SESSION) problems.push('E2E_FAKE_SESSION must not be set in production');
  return problems;
}
