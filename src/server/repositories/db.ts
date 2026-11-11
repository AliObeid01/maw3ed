import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { rootLogger } from '@/server/http/logger';

const VERIFYING_MODES = new Set(['require', 'prefer', 'verify-ca', 'verify-full']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * pg (v8) treats sslmode=require|prefer|verify-ca as verify-full and prints a warning because v9 will
 * switch to libpq semantics. Say what we mean explicitly: strip `sslmode` from the URL and pass an
 * `ssl` option.
 *
 * Fails closed: only localhost, 127.0.0.1 and ::1 may connect without TLS. Any other host always gets
 * TLS with certificate verification (a missing sslmode included). `disable`, `allow`, `no-verify` and any
 * unknown or misspelled value throw for a remote host, so a typo can never downgrade a production URL.
 */
export function poolConfigFromUrl(rawUrl: string): {
  connectionString: string;
  ssl?: { rejectUnauthorized: true };
} {
  const url = new URL(rawUrl);
  const local = LOCAL_HOSTS.has(url.hostname);
  const mode = url.searchParams.get('sslmode');
  url.searchParams.delete('sslmode');
  const tls = mode !== null && VERIFYING_MODES.has(mode);
  if (!local && mode !== null && !tls)
    throw new Error(
      `Refusing to connect to a remote database without TLS verification: unsupported sslmode "${mode}" (use require or verify-full).`,
    );
  const connectionString = mode === null ? rawUrl : url.toString();
  return !local || tls
    ? { connectionString, ssl: { rejectUnauthorized: true } }
    : { connectionString };
}

/**
 * TEST ONLY (DATABASE_POOL_CONNECT_TIMEOUT_MS): how long a request may wait for a pooled connection. Ignored when
 * NODE_ENV is production; otherwise clamped to 1000..120000 ms. Default 5000.
 */
export function poolConnectTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.DATABASE_POOL_CONNECT_TIMEOUT_MS);
  if (env.NODE_ENV === 'production' || !Number.isFinite(raw) || raw <= 0) return 5_000;
  return Math.min(120_000, Math.max(1_000, raw));
}

/** DATABASE_SCHEMA is a test seam: refused in production and restricted to a plain identifier. */
export function schemaFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const schema = env.DATABASE_SCHEMA;
  if (!schema) return undefined;
  if (env.NODE_ENV === 'production')
    throw new Error('DATABASE_SCHEMA must not be set in production.');
  if (!/^[a-z_][a-z0-9_]*$/.test(schema))
    throw new Error('DATABASE_SCHEMA is not a valid identifier.');
  return schema;
}

/**
 * The only Prisma client in the app. Only files under src/server/repositories may import this.
 * Runtime uses DATABASE_URL (pooled on Neon); migrations use DIRECT_URL via prisma.config.ts.
 *
 * Pool options suit Neon's pooled serverless endpoint: few connections per instance, short idle time,
 * fail fast on connect. `onPoolError` registers the pool 'error' listener so an error on an idle
 * connection is logged instead of crashing the process.
 */
function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const adapter = new PrismaPg(
    {
      ...poolConfigFromUrl(connectionString),
      max: 5,
      idleTimeoutMillis: 10_000,
      // Test seam (F22, TEST ONLY, ignored in production): a burst larger than the pool queues for a connection;
      // on a slow remote test database that wait can pass 5 s.
      connectionTimeoutMillis: poolConnectTimeoutMs(),
    },
    {
      // DATABASE_SCHEMA points the app at a non-default schema (integration tests use "itest").
      ...(schemaFromEnv() ? { schema: schemaFromEnv() } : {}),
      onPoolError: (err) => {
        rootLogger.error(
          { err: { name: err.name, message: err.message } },
          'idle database connection error',
        );
      },
    },
  );
  return new PrismaClient({ adapter });
}

const globalForDb = globalThis as unknown as { __maw3edDb?: PrismaClient };

function getClient(): PrismaClient {
  return (globalForDb.__maw3edDb ??= createClient());
}

/**
 * Unit of work. Inside `runInTransaction` every repository call (they all use `db`) runs on ONE interactive
 * transaction client and a repository's own `db.$transaction(fn)` joins it. Outside it nothing changes. Used by the
 * owner setup assistant so a whole plan is applied all-or-nothing THROUGH the same services the dashboard uses.
 */
const txStore = new AsyncLocalStorage<PrismaClient>();

// CAUTION: inside the callback every query runs on the one transaction connection and ROLLS BACK with it. Do not start
// anything fire-and-forget in here (it would outlive or race the transaction), and note that rate-limiter counters
// written inside are rolled back on failure too (spend budgets before entering).
export function runInTransaction<T>(fn: () => Promise<T>, options?: { timeoutMs?: number }): Promise<T> {
  if (txStore.getStore()) return fn(); // already inside one: join it
  return getClient().$transaction((tx) => txStore.run(tx as unknown as PrismaClient, fn), {
    timeout: options?.timeoutMs ?? 20_000,
    maxWait: 5_000,
  });
}

/**
 * Created lazily on first use, so importing this module (for example during `next build` or in a
 * preview without database variables) does not need DATABASE_URL; a missing URL still fails with a
 * clear error the first time a query runs.
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    // `await db` / Promise.resolve(db) probe `then`, and runtimes probe symbols (inspect, toPrimitive):
    // answer those without building a client so they neither need DATABASE_URL nor open a pool.
    if (prop === 'then' || typeof prop === 'symbol') return undefined;
    const joined = txStore.getStore();
    // A repository's own `db.$transaction(fn)` joins the surrounding unit of work instead of opening a second one.
    if (joined && prop === '$transaction')
      return (arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: PrismaClient) => Promise<unknown>)(joined)
          : Promise.all(arg as Promise<unknown>[]);
    const client = joined ?? getClient();
    const value = Reflect.get(client, prop, client) as unknown;
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(client)
      : value;
  },
  has: (_target, prop) => Reflect.has(getClient(), prop),
  ownKeys: () => Reflect.ownKeys(getClient()),
  getOwnPropertyDescriptor: (_target, prop) => {
    const descriptor = Reflect.getOwnPropertyDescriptor(getClient(), prop);
    // Proxy invariants: a reported property must be configurable because the target lacks it.
    return descriptor ? { ...descriptor, configurable: true } : undefined;
  },
  getPrototypeOf: () => Reflect.getPrototypeOf(getClient()),
});
