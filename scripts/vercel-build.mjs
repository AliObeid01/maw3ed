// Vercel runs this instead of `pnpm build` (the `vercel-build` script).
// Production deploys: verify the environment, apply database migrations, then build.
// Preview and development builds NEVER run migrations, so they cannot touch the production database.
import { spawnSync } from 'node:child_process';
import { checkProductionEnv, shouldMigrate } from './lib/productionEnv.mjs';

const run = (args) => {
  const r = spawnSync('pnpm', args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.error) console.error(`Could not start pnpm (${r.error.code ?? 'unknown error'})`);
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (shouldMigrate(process.env)) {
  const { errors, warnings } = checkProductionEnv(process.env);
  for (const w of warnings) console.warn(`Warning: ${w}`);
  if (errors.length > 0) {
    console.error('Production build blocked: fix these environment settings in Vercel (values are never printed):');
    for (const p of errors) console.error(` - ${p}`);
    process.exit(1);
  }
  console.log('Production environment looks right. Applying database migrations...');
  run(['exec', 'prisma', 'migrate', 'deploy']);
} else {
  console.log(`VERCEL_ENV=${process.env.VERCEL_ENV ?? '(not set)'}: skipping migrations.`);
}
// Build caches can skip the install postinstall hook, and src/generated is gitignored, so generate explicitly.
run(['exec', 'prisma', 'generate']);
run(['exec', 'next', 'build']);
// F39: no source map and no sourceMappingURL comment may stay in the deployment (even after a failed upload).
run(['exec', 'node', 'scripts/clean-sourcemaps.mjs']);
