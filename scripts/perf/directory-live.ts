/**
 * Measures `directory?include=nextFree` (a page of 12), `directory?when=` and `categories` on generated data:
 * ~60 listed businesses, 3 services, 3 staff, weekly hours and a week of bookings each. Counts the SQL
 * statements one call sends (no N+1) and times a cold call (first in the process) and warm calls.
 *
 * NOT a CI assertion (machine speed varies). Run by hand against a LOCAL scratch database:
 *
 *   DATABASE_URL_TEST=postgresql://... PERF_SCHEMA=perf_dir pnpm tsx scripts/perf/directory-live.ts
 *
 * It creates the schema `PERF_SCHEMA` (must start with `perf_`), applies every migration into it, fills it, measures
 * and drops it again. It refuses any other schema name and never touches the default schema.
 */
import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const schema = process.env.PERF_SCHEMA ?? 'perf_dir';
if (!/^perf_[a-z0-9_]+$/.test(schema)) throw new Error('PERF_SCHEMA must match perf_[a-z0-9_]+');
const base = process.env.DATABASE_URL_TEST;
if (!base) throw new Error('DATABASE_URL_TEST is not set');
const host = new URL(base).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host))
  throw new Error('Refusing to run against a non-local database.');

const BUSINESSES = Number(process.env.PERF_BUSINESSES ?? 60);

const admin = new pg.Client({ connectionString: base });
await admin.connect();
try {
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`SET search_path TO ${schema}`);
  const dir = path.resolve('prisma/migrations');
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const n of names)
    await admin.query(readFileSync(path.join(dir, n, 'migration.sql'), 'utf8'));

  await admin.query(
    `INSERT INTO "Business" (id, slug, name, category, area, timezone, listed, "updatedAt")
     SELECT 'pb-' || g, 'perf-place-' || g, 'Perf Place ' || lpad(g::text, 3, '0'),
       (ARRAY['barbers','hair-salons','dental-clinics','beauty-clinics','spa-massage','physiotherapy'])[1 + g % 6],
       (ARRAY['beirut','sidon','tripoli','jounieh','tyre','zahle'])[1 + g % 6], 'Asia/Beirut', true, now()
     FROM generate_series(1, $1::int) g`,
    [BUSINESSES],
  );
  await admin.query(
    `INSERT INTO "Service" (id, "businessId", name, "durationMin", price, "updatedAt")
     SELECT 'ps-' || b.g || '-' || s.k, 'pb-' || b.g, (ARRAY['Haircut','Beard trim','Colour'])[s.k],
       (ARRAY[30,20,90])[s.k], (ARRAY[15,8,60])[s.k] + b.g % 5, now()
     FROM generate_series(1, $1::int) b(g), generate_series(1, 3) s(k)`,
    [BUSINESSES],
  );
  await admin.query(
    `INSERT INTO "StaffMember" (id, "businessId", "displayName", "updatedAt")
     SELECT 'pst-' || b.g || '-' || s.k, 'pb-' || b.g, 'Perf Staff ' || b.g || '-' || s.k, now()
     FROM generate_series(1, $1::int) b(g), generate_series(1, 3) s(k)`,
    [BUSINESSES],
  );
  await admin.query(
    `INSERT INTO "StaffService" ("staffId", "serviceId", "businessId")
     SELECT 'pst-' || b.g || '-' || s.k, 'ps-' || b.g || '-' || v.k, 'pb-' || b.g
     FROM generate_series(1, $1::int) b(g), generate_series(1, 3) s(k), generate_series(1, 3) v(k)`,
    [BUSINESSES],
  );
  await admin.query(
    `INSERT INTO "WorkingHours" (id, "businessId", "staffId", weekday, "startLocal", "endLocal")
     SELECT 'pwh-' || b.g || '-' || s.k || '-' || w.d, 'pb-' || b.g, 'pst-' || b.g || '-' || s.k, w.d, '09:00', '18:00'
     FROM generate_series(1, $1::int) b(g), generate_series(1, 3) s(k), generate_series(1, 6) w(d)`,
    [BUSINESSES],
  );
  await admin.query(
    `INSERT INTO "Client" (id, "businessId", name, phone, "updatedAt")
     SELECT 'pc-' || g, 'pb-' || g, 'Perf Client', '+9617' || lpad(g::text, 7, '0'), now() FROM generate_series(1, $1::int) g`,
    [BUSINESSES],
  );
  // ~24 bookings per staff over the coming week (non-overlapping: hourly slots from 07:00Z).
  await admin.query(
    `INSERT INTO "Appointment" (id, "businessId", "clientId", "staffId", "serviceId", "startAt", "endAt", "blockedUntil", status, "updatedAt")
     SELECT 'pa-' || b.g || '-' || s.k || '-' || d.d || '-' || h.h, 'pb-' || b.g, 'pc-' || b.g, 'pst-' || b.g || '-' || s.k, 'ps-' || b.g || '-1',
       date_trunc('day', now()) + (d.d || ' days')::interval + ((7 + h.h) || ' hours')::interval,
       date_trunc('day', now()) + (d.d || ' days')::interval + ((7 + h.h) || ' hours')::interval + interval '30 minutes',
       date_trunc('day', now()) + (d.d || ' days')::interval + ((7 + h.h) || ' hours')::interval + interval '30 minutes',
       'BOOKED', now()
     FROM generate_series(1, $1::int) b(g), generate_series(1, 3) s(k), generate_series(0, 6) d(d), generate_series(0, 3) h(h)`,
    [BUSINESSES],
  );
  const counts = await admin.query(
    `SELECT (SELECT count(*) FROM "Business") b, (SELECT count(*) FROM "Appointment") a`,
  );
  console.log('data:', counts.rows[0]);

  // Point the app's own Prisma client at the scratch schema BEFORE importing it.
  const url = new URL(base);
  url.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  process.env.DATABASE_SCHEMA = schema;

  let statements = 0;
  const original = pg.Client.prototype.query as (...args: unknown[]) => unknown;
  (pg.Client.prototype as unknown as { query: unknown }).query = function (
    this: unknown,
    ...args: unknown[]
  ) {
    statements++;
    return original.apply(this, args);
  };

  const { directoryService } = await import('../../src/server/services/directory');
  const { categoriesService } = await import('../../src/server/services/categories');

  const cases: [string, () => Promise<unknown>][] = [
    ['directory page of 12 (no include)', () => directoryService.list({ limit: 12 } as never)],
    [
      'directory?include=nextFree (page of 12)',
      () => directoryService.list({ include: 'nextFree' } as never),
    ],
    [
      'directory?when=<tomorrow> (scan up to 36)',
      () =>
        directoryService.list({
          when: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
        } as never),
    ],
    ['categories', () => categoriesService.list({})],
    ['categories?area=beirut', () => categoriesService.list({ area: 'beirut' })],
  ];
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)]!;
  const rows: Record<string, string | number>[] = [];
  for (const [name, run] of cases) {
    statements = 0;
    const t0 = performance.now();
    await run();
    const cold = performance.now() - t0;
    const sql = statements;
    const warm: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      await run();
      warm.push(performance.now() - t);
    }
    rows.push({
      call: name,
      'SQL statements': sql,
      'first call ms': Math.round(cold),
      'warm median ms': Math.round(median(warm)),
      'warm p95 ms': Math.round(p95(warm)),
    });
  }
  console.table(rows);
} finally {
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
  const { db } = await import('../../src/server/repositories/db');
  await db.$disconnect().catch(() => undefined);
}
