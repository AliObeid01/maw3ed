/**
 * demo:seed. Loads the simulated demo businesses (see docs/DEMO_DATA.md).
 *
 *   DRY RUN (default, writes nothing):  pnpm demo:seed
 *   WRITE:                              pnpm demo:seed --apply --confirm-host <host of DIRECT_URL>
 *
 * Environment (read from the shell only, never from a file): DIRECT_URL (or DATABASE_URL), DEMO_OWNER_EMAIL,
 * DEMO_OWNER_PASSWORD (12+ characters), optional DEMO_OWNER_NAME, optional EXPECTED_DB_HOST.
 * Options: --now <ISO> (reproducible runs), --seed <n>.
 */
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../../src/server/services/password';
import { generateLogo } from './logos';
import { GuardError, assertApplyAllowed, parseArgs, readOwnerEnv, resolveDbTarget } from './guards';
import { buildPlan, summarizePlan, ZONE } from './plan';
import { connect, countRows, findConflicts, seedDemo } from './runner';
import type { ProcessedLogo } from '../../src/server/services/logoImage';

const out = (line = '') => console.log(line);

function table(title: string, rows: [string, string | number][]) {
  out(title);
  const width = Math.max(...rows.map(([k]) => k.length));
  for (const [k, v] of rows) out(`  ${k.padEnd(width)}  ${v}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const owner = readOwnerEnv(process.env);
  const target = args.apply
    ? assertApplyAllowed({ confirmHost: args.confirmHost, env: process.env })
    : resolveDbTarget(process.env);
  const now = args.now ?? new Date();

  out(`Maw3ed demo seed: ${args.apply ? 'APPLY (writes)' : 'DRY RUN (writes nothing)'}`);
  out(`Database host: ${target.host} (from ${target.source})`);
  out(`Now: ${now.toISOString()}  (all dates computed in ${ZONE})`);
  out(`Demo owner: ${owner.email}  (password is not printed)`);
  out();

  const placeholderHash = await hashPassword(randomBytes(32).toString('hex'));
  const ownerHash = await hashPassword(owner.password);
  const plan = buildPlan({
    now,
    ...(args.seed !== undefined ? { seed: args.seed } : {}),
    owner: { email: owner.email, name: owner.name, passwordHash: ownerHash },
    placeholderHash,
  });
  const sum = summarizePlan(plan);
  table('Plan', [
    ['businesses', sum.total.businesses],
    ['users (1 demo owner, 1 receptionist, 17 placeholder owners)', sum.total.users],
    ['staff', sum.total.staff],
    ['services', sum.total.services],
    ['clients', sum.total.clients],
    ['appointments', sum.total.appointments],
    ['reminder jobs', sum.total.reminderJobs],
    ['waitlist entries / offers', `${sum.total.waitlistEntries} / ${sum.total.waitlistOffers}`],
    ['logos', sum.total.logos],
    ['pilot baselines', sum.total.baselines],
  ]);
  out();
  table('Appointments by status', Object.entries(sum.byStatus).sort());
  out();

  const prisma = connect(target.url);
  try {
    let conflicts;
    try {
      conflicts = await findConflicts(prisma, plan);
    } catch (e) {
      if (args.apply) throw e;
      out(`Could not check the database for existing demo rows (${e instanceof Error ? e.message : String(e)}).`);
      return;
    }
    if (conflicts.slugs.length || conflicts.emails.length) {
      out('REFUSED: the database already contains demo rows. Nothing was written.');
      if (conflicts.slugs.length) out(`  existing business slugs: ${conflicts.slugs.join(', ')}`);
      if (conflicts.emails.length) out(`  existing user e-mails:   ${conflicts.emails.join(', ')}`);
      out('Run "pnpm demo:remove" (dry run first) to take them out, then seed again.');
      process.exitCode = 1;
      return;
    }
    if (!args.apply) {
      out('No conflicts found. This was a dry run: nothing was written.');
      out(`To write, run again with:  --apply --confirm-host ${target.host}`);
      return;
    }

    out('Generating logos ...');
    const logos = new Map<string, ProcessedLogo>();
    let variant = 0;
    for (const b of plan.businesses) if (b.spec.logo) logos.set(b.spec.slug, await generateLogo(b.spec.name, variant++));

    out('Writing (one transaction per business) ...');
    try {
      await seedDemo(prisma, plan, logos, out);
    } catch (e) {
      out();
      out(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
      out('Part of the demo data may have been written. Run "pnpm demo:remove" (dry run, then --apply) to clean up, then try again.');
      process.exitCode = 1;
      return;
    }

    const ids = plan.businesses.map((b) => b.business.id);
    const counts = await countRows(prisma, ids);
    out();
    table('Written', Object.entries(counts).filter(([, n]) => n > 0));
    const jobs = await prisma.reminderJob.groupBy({
      by: ['kind', 'channel', 'status'],
      where: { businessId: { in: ids } },
      _count: { _all: true },
    });
    out();
    table(
      'Reminder jobs (kind / channel / status)',
      jobs.map((j) => [`${j.kind} / ${j.channel} / ${j.status}`, j._count._all] as [string, number]),
    );
    out();
    out('Done. Next: pnpm demo:check');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  if (e instanceof GuardError) {
    console.error(`Refused: ${e.message}`);
    process.exit(2);
  }
  console.error(e);
  process.exit(1);
});
