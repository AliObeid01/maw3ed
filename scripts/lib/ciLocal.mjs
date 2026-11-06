// Pure parts of scripts/ci-local.mjs (step list, argument parsing, localhost guard). No I/O, so Vitest can cover them.

export const SCRATCH_SCHEMA = 'itest_cilocal';

/** Throwaway values, identical to the `env:` block of the `checks` job in .github/workflows/ci.yml. Never real secrets. */
export const CI_ENV = {
  DATABASE_URL: 'postgresql://maw3ed:maw3ed@localhost:5432/maw3ed_test',
  DIRECT_URL: 'postgresql://maw3ed:maw3ed@localhost:5432/maw3ed_test',
  DATABASE_URL_TEST: 'postgresql://maw3ed:maw3ed@localhost:5432/maw3ed_test',
  APP_URL: 'http://localhost:3000',
  SESSION_SECRET: 'ci-only-session-secret-0000000000000000',
  LINK_SECRET: 'ci-only-link-secret-000000000000000000',
  CRON_SECRET: 'ci-only-cron-secret-0000000000000000',
  EMAIL_PROVIDER: 'fake',
  PAYMENT_PROVIDER: 'fake',
};

const DB_VARS = ['DATABASE_URL', 'DIRECT_URL', 'DATABASE_URL_TEST'];
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Throws when any database URL in `env` points anywhere but localhost / 127.0.0.1. Never echoes the URL. */
export function assertLocalDatabases(env) {
  for (const name of DB_VARS) {
    const value = env[name];
    if (value === undefined || value === '') continue;
    let host;
    try {
      host = new URL(value).hostname;
    } catch {
      throw new Error(`Refusing to run: ${name} is not a valid URL.`);
    }
    if (!LOCAL_HOSTS.has(host)) {
      throw new Error(`Refusing to run: ${name} points at "${host}", not localhost / 127.0.0.1.`);
    }
  }
}

/** The same sequence as the `checks` job of ci.yml, plus the contrast script; `e2e` adds the CI Playwright runs. */
export function buildSteps({ e2e, skipInt = false }) {
  const steps = [
    { id: 'lint', title: 'Lint', cmd: 'pnpm lint' },
    { id: 'typecheck', title: 'Typecheck', cmd: 'pnpm typecheck' },
    { id: 'unit', title: 'Unit tests', cmd: 'pnpm test:unit --passWithNoTests' },
    { id: 'db-up', title: 'Start local Postgres', cmd: 'docker compose up -d --wait db', group: 'db' },
    {
      id: 'integration',
      title: `Integration tests (schema ${SCRATCH_SCHEMA})`,
      cmd: 'pnpm test:int --passWithNoTests',
      env: { ITEST_SCHEMA: SCRATCH_SCHEMA },
      needs: ['db-up', 'db-drop'],
    },
    { id: 'build', title: 'Build', cmd: 'pnpm build' },
    { id: 'openapi', title: 'OpenAPI contract', cmd: 'pnpm openapi:check' },
    { id: 'i18n', title: 'i18n keys', cmd: 'node scripts/i18n/check-keys.mjs' },
    { id: 'contrast', title: 'Contrast', cmd: 'node scripts/design/contrast.mjs' },
    {
      id: 'db-drop',
      title: `Drop scratch schema ${SCRATCH_SCHEMA}`,
      cmd: `docker compose exec -T db psql -U maw3ed -d maw3ed_test -c "DROP SCHEMA IF EXISTS ${SCRATCH_SCHEMA} CASCADE"`,
      always: true,
    },
  ];
  if (skipInt) {
    // Light mode: no Docker Postgres, no integration run, no scratch schema. CI stays the full verdict.
    const dropped = new Set(['db-up', 'integration', 'db-drop']);
    steps.splice(0, steps.length, ...steps.filter((s) => !dropped.has(s.id)));
  }
  if (e2e) {
    steps.push(
      {
        id: 'e2e-mobile',
        title: 'Playwright: mobile + dashboard-mobile',
        cmd: 'pnpm exec playwright test --project=mobile --project=dashboard-mobile',
      },
      {
        id: 'e2e-desktop',
        title: 'Playwright: dashboard shell at desktop width',
        cmd: 'pnpm exec playwright test --project=dashboard-desktop tests/e2e/dashboard/shell.spec.ts',
      },
    );
  }
  return steps;
}

export function parseArgs(argv) {
  const out = { dryRun: false, keepGoing: false, e2e: false, skipInt: false, only: null, help: false };
  const args = argv.filter((a, i) => !(a === '--' && i === 0));
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') continue;
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--keep-going') out.keepGoing = true;
    else if (a === '--e2e') out.e2e = true;
    else if (a === '--skip-int') out.skipInt = true;
    else if (a === '--only') {
      const v = args[++i];
      if (!v) throw new Error('--only needs a comma-separated list of step ids.');
      out.only = v.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a.startsWith('--only=')) out.only = a.slice(7).split(',').map((s) => s.trim()).filter(Boolean);
    else throw new Error(`Unknown option: ${a}`);
  }
  if (out.only) {
    const known = new Set(buildSteps({ e2e: true }).map((s) => s.id));
    for (const id of out.only) if (!known.has(id)) throw new Error(`Unknown step: ${id}`);
    if (out.only.some((id) => id.startsWith('e2e'))) out.e2e = true;
    if (out.skipInt && out.only.some((id) => ['integration', 'db-up', 'db-drop'].includes(id)))
      throw new Error('--skip-int cannot be combined with --only integration (or db-up / db-drop).');
  }
  return out;
}

/** Applies --only; a selected integration step also pulls in the database start and the scratch-schema drop. */
export function selectSteps(steps, only) {
  if (!only) return steps;
  const wanted = new Set(only);
  for (const s of steps) if (wanted.has(s.id)) for (const n of s.needs ?? []) wanted.add(n);
  return steps.filter((s) => wanted.has(s.id));
}

export const HELP = `pnpm ci:local - run the CI "checks" job on this machine (no GitHub Actions minutes)

Usage: pnpm ci:local -- [options]

Steps, in order (same as .github/workflows/ci.yml): lint, typecheck, unit, db-up, integration, build,
openapi, i18n, contrast (extra, not in CI), db-drop. With --e2e also: e2e-mobile, e2e-desktop.

Options:
  --e2e            also run the Playwright projects CI uses (mobile, dashboard-mobile, then the desktop shell spec)
  --skip-int       light mode: skip db-up, integration and db-drop (no Docker Postgres needed). For agents: the full
                   integration suite is not run locally; run only the touched integration files by hand, CI is the verdict
  --only a,b       run only these step ids (integration adds db-up and db-drop)
  --keep-going     do not stop at the first failure
  --dry-run        print the plan and exit without running anything
  --help           this text

Safety: uses throwaway CI env values, never reads secrets, refuses to run when DATABASE_URL, DIRECT_URL or
DATABASE_URL_TEST in your shell point anywhere but localhost / 127.0.0.1. Integration tests use the scratch
schema "${SCRATCH_SCHEMA}" in the local Docker Postgres (docker compose up -d db) and drop it at the end.
Exit code is non-zero when a step fails. Summary: .ci-local/summary.md
`;
