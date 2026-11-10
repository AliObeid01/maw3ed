/**
 * demo:remove. Deletes ONLY the demo businesses of scripts/demo/manifest.ts (found by slug) with all their rows, the
 * placeholder owners, and the demo owner (only if DEMO_OWNER_EMAIL is set and that user belongs to no other business).
 *
 *   DRY RUN (default):  pnpm demo:remove
 *   WRITE:              pnpm demo:remove --apply --confirm-host <host of DIRECT_URL>
 */
import { GuardError, assertApplyAllowed, parseArgs, resolveDbTarget } from './guards';
import { connect, removeDemo, type RowCounts } from './runner';

const out = (line = '') => console.log(line);

function counts(title: string, c: RowCounts) {
  out(title);
  for (const [k, v] of Object.entries(c)) if (v > 0) out(`  ${k.padEnd(14)} ${v}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = args.apply
    ? assertApplyAllowed({ confirmHost: args.confirmHost, env: process.env })
    : resolveDbTarget(process.env);
  const demoOwnerEmail = process.env.DEMO_OWNER_EMAIL?.trim() || undefined;

  out(`Maw3ed demo remove: ${args.apply ? 'APPLY (deletes)' : 'DRY RUN (deletes nothing)'}`);
  out(`Database host: ${target.host} (from ${target.source})`);
  out(demoOwnerEmail ? `Demo owner to remove: ${demoOwnerEmail}` : 'DEMO_OWNER_EMAIL is not set: the demo owner user will NOT be removed.');
  out();

  const prisma = connect(target.url);
  try {
    const report = await removeDemo(prisma, { demoOwnerEmail, apply: args.apply }, out);
    out(`Demo businesses found: ${report.businesses.length}`);
    for (const b of report.businesses) out(`  ${b.slug}`);
    out();
    counts(args.apply ? 'Rows before' : 'Rows that would be deleted', report.before);
    out();
    out(`Users ${args.apply ? 'deleted' : 'that would be deleted'}: ${report.users.deleted.length}`);
    for (const k of report.users.kept) out(`  KEPT ${k.email} (${k.reason})`);
    if (report.after) {
      out();
      counts('Rows after (should be empty)', report.after);
      out();
      out('Done. Only the demo businesses and demo users were touched.');
    } else {
      out();
      out('This was a dry run: nothing was deleted.');
      out(`To delete, run again with:  --apply --confirm-host ${target.host}`);
    }
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
