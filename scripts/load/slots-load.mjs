#!/usr/bin/env node
/**
 * NFR-09 seeded load test: GET /api/public/{slug}/slots for a 14-day range, "anyone" across 10 bookable staff.
 * Reports p50 / p95 / max over N requests and exits 1 only if p95 >= 300 ms (P95_BUDGET_MS).
 *
 * Run locally (LOCAL Docker database only; the script refuses any non-local DB host):
 *   docker compose up -d db
 *   pnpm prisma migrate deploy        # DATABASE_URL pointing at the local Docker Postgres
 *   # terminal 1: serve a PRODUCTION build against the SAME database (what the nightly job measures). The slots
 *   # route limit is 300 requests / 10 min / IP, so keep WARMUP + REQUESTS under 300 (the defaults are 210).
 *   pnpm build && pnpm start
 *   # (alternative: `RATE_LIMIT_DISABLED=1 pnpm dev` removes the limit, but dev-mode timings are far slower.)
 *   # terminal 2:
 *   DATABASE_URL=postgresql://maw3ed:maw3ed@localhost:5432/maw3ed_test node scripts/load/slots-load.mjs
 *
 * Options (env): BASE_URL (default http://localhost:3000), REQUESTS (default 200), CONCURRENCY (default 10),
 * WARMUP (default 10), P95_BUDGET_MS (default 300), KEEP=1 to leave the seeded business in place.
 * Never point this at Neon or production. CI runs it only from .github/workflows/load.yml (not on PRs).
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const REQUESTS = Number(process.env.REQUESTS ?? 200);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);
const WARMUP = Number(process.env.WARMUP ?? 10);
const BUDGET = Number(process.env.P95_BUDGET_MS ?? 300);
const SLUG = 'load-test-nfr09';
const STAFF = 10;
const DAYS = 14;

function fail(message) {
  console.error(`slots-load: ${message}`);
  process.exit(2);
}

if (!DATABASE_URL) fail('DATABASE_URL is required (local Docker Postgres).');
const dbHost = new URL(DATABASE_URL).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(dbHost))
  fail(`refusing to seed a non-local database (${dbHost}).`);
if (process.env.NODE_ENV === 'production') fail('NODE_ENV=production.');
const appHost = new URL(BASE_URL).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(appHost))
  fail(`refusing to load a non-local server (${appHost}).`);

const id = () => `ld${randomBytes(10).toString('hex')}`;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

async function wipe(client) {
  const { rows } = await client.query('SELECT id FROM "Business" WHERE slug = $1', [SLUG]);
  for (const { id: b } of rows) {
    for (const t of [
      'ReminderJob',
      'Appointment',
      'Client',
      'WorkingHours',
      'StaffService',
      'StaffMember',
      'Service',
    ])
      await client.query(`DELETE FROM "${t}" WHERE "businessId" = $1`, [b]);
    await client.query('DELETE FROM "Business" WHERE id = $1', [b]);
  }
}

async function seed(client) {
  await wipe(client);
  const businessId = id();
  const serviceId = id();
  await client.query(
    `INSERT INTO "Business" (id, slug, name, timezone, locale, plan, "bookingWindowDays", "minNoticeMin", "updatedAt")
     VALUES ($1, $2, 'Load test salon', 'Asia/Beirut', 'en', 'PRO', 60, 0, now())`,
    [businessId, SLUG],
  );
  await client.query(
    `INSERT INTO "Service" (id, "businessId", name, "durationMin", "bufferMin", price, "updatedAt")
     VALUES ($1, $2, 'Haircut', 30, 0, 15, now())`,
    [serviceId, businessId],
  );
  const clientId = id();
  await client.query(
    `INSERT INTO "Client" (id, "businessId", name, phone, "updatedAt") VALUES ($1, $2, 'Load client', '+96171000000', now())`,
    [clientId, businessId],
  );
  const today = new Date();
  const day0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1);
  let appointments = 0;
  for (let s = 0; s < STAFF; s++) {
    const staffId = id();
    await client.query(
      `INSERT INTO "StaffMember" (id, "businessId", "displayName", bookable, active, "updatedAt")
       VALUES ($1, $2, $3, true, true, now())`,
      [staffId, businessId, `Staff ${s + 1}`],
    );
    await client.query(
      `INSERT INTO "StaffService" ("staffId", "serviceId", "businessId") VALUES ($1, $2, $3)`,
      [staffId, serviceId, businessId],
    );
    // 08:00-20:00 every weekday of the week.
    for (let weekday = 0; weekday < 7; weekday++)
      await client.query(
        `INSERT INTO "WorkingHours" (id, "businessId", "staffId", weekday, "startLocal", "endLocal")
         VALUES ($1, $2, $3, $4, '08:00', '20:00')`,
        [id(), businessId, staffId, weekday],
      );
    // Some appointments: five 30-minute bookings per staff per day, staggered so the staff are not identical.
    for (let d = 0; d < DAYS; d++)
      for (let k = 0; k < 5; k++) {
        const startMs = day0 + d * 86_400_000 + (7 + ((s + k * 2) % 11)) * 3_600_000;
        const startAt = new Date(startMs);
        const endAt = new Date(startMs + 30 * 60_000);
        await client.query(
          `INSERT INTO "Appointment" (id, "businessId", "clientId", "staffId", "serviceId", "startAt", "endAt", "blockedUntil", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7, now()) ON CONFLICT DO NOTHING`,
          [id(), businessId, clientId, staffId, serviceId, startAt, endAt],
        );
        appointments++;
      }
  }
  console.log(`seeded ${STAFF} staff, ${DAYS} days of hours, ~${appointments} appointments (slug ${SLUG}).`);
  return { serviceId, from: ymd(new Date(day0)), to: ymd(new Date(day0 + (DAYS - 1) * 86_400_000)) };
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  let plan;
  try {
    plan = await seed(client);
  } finally {
    await client.end();
  }
  const url = `${BASE_URL}/api/public/${SLUG}/slots?serviceId=${plan.serviceId}&from=${plan.from}&to=${plan.to}`;
  const hit = async () => {
    const t0 = performance.now();
    const res = await fetch(url);
    const body = await res.json();
    const ms = performance.now() - t0;
    if (res.status !== 200 || !Array.isArray(body.slots) || body.slots.length === 0)
      throw new Error(`unexpected response ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
    return ms;
  };

  let exit = 0;
  try {
    for (let i = 0; i < WARMUP; i++) await hit();
    const times = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (next++ < REQUESTS) times.push(await hit());
      }),
    );
    times.sort((a, b) => a - b);
    const p50 = percentile(times, 50);
    const p95 = percentile(times, 95);
    const max = times[times.length - 1];
    console.log(
      `GET ${url}\n${times.length} requests, concurrency ${CONCURRENCY}: p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${max.toFixed(1)} ms (budget p95 < ${BUDGET} ms)`,
    );
    if (p95 >= BUDGET) {
      console.error(`FAIL: p95 ${p95.toFixed(1)} ms >= ${BUDGET} ms`);
      exit = 1;
    }
  } catch (err) {
    console.error(`slots-load: ${err.message}`);
    exit = 2;
  } finally {
    if (process.env.KEEP !== '1') {
      const cleanup = new pg.Client({ connectionString: DATABASE_URL });
      await cleanup.connect();
      await wipe(cleanup);
      await cleanup.end();
    }
  }
  process.exit(exit);
}

main();
