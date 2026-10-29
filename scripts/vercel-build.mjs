// Vercel runs this instead of `pnpm build` (the `vercel-build` script).
// Production deploys: verify the environment, apply database migrations, then build.
// Preview and development builds NEVER run migrations, so they cannot touch the production database.
import { spawnSync } from 'node:child_process';
import { productionEnvProblems } from './lib/productionEnv.mjs';

const run = (args) => {
  const r = spawnSync('pnpm', args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (process.env.VERCEL_ENV === 'production') {
  const problems = productionEnvProblems(process.env);
  if (problems.length > 0) {
    console.error('Production build blocked: fix these environment settings in Vercel (values are never printed):');
    for (const p of problems) console.error(` - ${p}`);
    process.exit(1);
  }
  console.log('Production environment looks right. Applying database migrations...');
  run(['exec', 'prisma', 'migrate', 'deploy']);
} else {
  console.log(`VERCEL_ENV=${process.env.VERCEL_ENV ?? '(not set)'}: skipping migrations.`);
}
run(['exec', 'next', 'build']);
