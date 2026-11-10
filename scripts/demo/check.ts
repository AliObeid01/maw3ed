/**
 * demo:check. Read-only: prints a summary and checks the invariants of the demo data (see docs/DEMO_DATA.md).
 *   pnpm demo:check            (use --now <ISO> to check as of another instant)
 * Uses DIRECT_URL, else DATABASE_URL. Never writes.
 */
import { GuardError, parseArgs, resolveDbTarget } from './guards';

const out = (line = '') => console.log(line);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.apply || args.confirmHost) throw new GuardError('demo:check is read-only and takes no --apply or --confirm-host.');
  const target = resolveDbTarget(process.env);
  // The real services (slots, pilot report) use the app's own client: point it at the same database.
  process.env.DATABASE_URL = target.url;
  const { connect } = await import('./runner');
  const { runChecks } = await import('./checks');
  const now = args.now ?? new Date();

  out(`Maw3ed demo check (read-only)  host ${target.host}  now ${now.toISOString()}`);
  out();
  const prisma = connect(target.url);
  try {
    const report = await runChecks(prisma, now);
    for (const c of report.checks) out(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  (${c.detail})`);
    if (report.pilot) {
      const p = report.pilot;
      out();
      out('Flagship pilot report (the real report service)');
      out(`  baseline            ${p.baselineNoShows}/${p.baselineAppointments} = ${p.baselineRate}%`);
      out(`  current no-show     ${p.currentRate}%  (${p.noShows} no-shows, ${p.attended} attended, ${p.lateCancels} late cancels)`);
      out(`  relative change     ${p.relativeChangePct}%`);
      out(`  confirm rate        ${p.confirmRate}%`);
      out(`  link cancellations  ${p.cancellationsViaLink} of ${p.appointments + 0} counted appointments`);
      out(`  waitlist refills    ${p.waitlistRefills} of ${p.waitlistSlotsOffered} offered slots = ${p.waitlistRefillRate}%`);
      out(`  weekly no-show      ${p.weekly.map((w) => `${w.weekStart.slice(5)}: ${w.noShowRate ?? '-'}%`).join('  ')}`);
    }
    out();
    out(report.ok ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
    if (!report.ok) process.exitCode = 1;
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
