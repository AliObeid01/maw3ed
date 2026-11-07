/**
 * Timing parity of the barber's appointment detail (GET /api/appointments/{id}) for three outcomes:
 *   own id (200), a FOREIGN id (another barber's / business's appointment, 404) and an UNLINKED barber (403).
 * An observer who can time requests must not learn from latency which case they hit, so the three should do
 * the same amount of work. This script counts the SQL statements one request sends and takes N timed samples
 * of each (interleaved, after a warm-up), then prints median and p95.
 *
 * NOT a CI assertion (latency is noisy). Run by hand against a LOCAL scratch database; it uses the integration
 * helpers, so the schema is `itest*` and is recreated (dropped contents!) by this run:
 *
 *   DATABASE_URL_TEST=postgresql://... ITEST_SCHEMA=itest_perfbarber pnpm tsx scripts/perf/barber-timing.ts [samples]
 */
import 'dotenv/config';

process.env.ITEST_SCHEMA ??= 'itest_perfbarber';
if (!/^itest_perf[a-z0-9_]*$/.test(process.env.ITEST_SCHEMA))
  throw new Error('ITEST_SCHEMA must match itest_perf*');
const base = process.env.DATABASE_URL_TEST;
if (!base) throw new Error('DATABASE_URL_TEST is not set');
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(base).hostname))
  throw new Error('Refusing to run against a non-local database.');

const SAMPLES = Number(process.argv[2] ?? 200);

await import('../../tests/integration/helpers/env');
const pgModule = await import('pg');
const { setupSchema, newClient, truncateAll, newPrisma } =
  await import('../../tests/integration/helpers/db');
const { call } = await import('../../tests/integration/helpers/api');
const { newScenario, newTenant } = await import('../../tests/integration/helpers/booking');
const { activatedPractitioner } = await import('../../tests/integration/helpers/practitioner');
const { seedAppointment, seedClient } = await import('../../tests/integration/helpers/outcomes');
const { GET } = await import('../../src/app/api/appointments/[id]/route');

await setupSchema();
const pg = newClient();
await pg.connect();
await truncateAll(pg);
const prisma = newPrisma();

try {
  const tenant = await newTenant({ businessName: 'Timing Studio' });
  const scn = await newScenario(prisma, tenant);
  const barberA = await activatedPractitioner(tenant, '+96170000011', 'Barber A');
  const barberB = await activatedPractitioner(tenant, '+96170000012', 'Barber B');
  const unlinked = await activatedPractitioner(tenant, '+96170000013', 'Barber C');
  // The third login keeps its session and role but loses its staff link: the "no schedule linked" 403.
  await pg.query(`UPDATE "StaffMember" SET "userId" = NULL WHERE id = $1`, [unlinked.staffId]);

  const mk = async (staffId: string, hour: number) => {
    const client = await seedClient(prisma, tenant.businessId, {});
    return seedAppointment(prisma, {
      businessId: tenant.businessId,
      clientId: client.id,
      staffId,
      serviceId: scn.serviceId,
      startAt: new Date(Date.UTC(2030, 0, 2, hour)).toISOString(),
    });
  };
  const own = await mk(barberA.staffId, 7);
  const foreign = await mk(barberB.staffId, 7);

  const scenarios = [
    { name: 'own id (200)', cookie: barberA.cookie, id: own.id, status: 200 },
    { name: 'foreign id (404)', cookie: barberA.cookie, id: foreign.id, status: 404 },
    { name: 'unlinked barber (403)', cookie: unlinked.cookie, id: own.id, status: 403 },
  ];

  const sqlText = (q: unknown) =>
    String(typeof q === 'string' ? q : ((q as { text?: string })?.text ?? ''))
      .replace(/\s+/g, ' ')
      .replace(/"[a-z_0-9]+"\./g, '')
      .slice(0, 120);
  let statements = 0;
  let trace: string[] | undefined;
  const clientProto = pgModule.default.Client.prototype as unknown as {
    query: (...a: unknown[]) => unknown;
  };
  const original = clientProto.query;
  clientProto.query = function (this: unknown, ...args: unknown[]) {
    statements++;
    if (trace) trace.push(sqlText(args[0]));
    return original.apply(this, args);
  };

  const run = async (s: (typeof scenarios)[number]) => {
    const t0 = performance.now();
    const res = await call(GET, `/api/appointments/${s.id}`, {
      cookie: s.cookie,
      params: { id: s.id },
    });
    const ms = performance.now() - t0;
    if (res.status !== s.status)
      throw new Error(`${s.name}: expected ${s.status}, got ${res.status}`);
    return ms;
  };

  for (let i = 0; i < 30; i++) for (const s of scenarios) await run(s);

  const perRequest = new Map<string, number>();
  for (const s of scenarios) {
    statements = 0;
    trace = process.env.PERF_SQL ? [] : undefined;
    await run(s);
    perRequest.set(s.name, statements);
    if (trace) console.log([`SQL ${s.name}`, ...trace].join('\n  '));
    trace = undefined;
  }

  const samples = new Map<string, number[]>(scenarios.map((s) => [s.name, []]));
  for (let i = 0; i < SAMPLES; i++)
    for (const s of scenarios) samples.get(s.name)!.push(await run(s));
  clientProto.query = original;

  const q = (xs: number[], p: number) =>
    [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]!;
  console.table(
    scenarios.map((s) => ({
      case: s.name,
      'SQL statements': perRequest.get(s.name),
      samples: SAMPLES,
      'median ms': Number(q(samples.get(s.name)!, 0.5).toFixed(2)),
      'p95 ms': Number(q(samples.get(s.name)!, 0.95).toFixed(2)),
    })),
  );
} finally {
  await prisma.$disconnect();
  await pg.query(`DROP SCHEMA IF EXISTS ${process.env.ITEST_SCHEMA} CASCADE`);
  await pg.end();
  const { db } = await import('../../src/server/repositories/db');
  await db.$disconnect().catch(() => undefined);
}
