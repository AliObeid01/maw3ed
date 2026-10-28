import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { rootLogger } from '@/server/http/logger';

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
    { connectionString, max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 },
    {
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
 * Created lazily on first use, so importing this module (for example during `next build` or in a
 * preview without database variables) does not need DATABASE_URL; a missing URL still fails with a
 * clear error the first time a query runs.
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    // `await db` / Promise.resolve(db) probe `then`, and runtimes probe symbols (inspect, toPrimitive):
    // answer those without building a client so they neither need DATABASE_URL nor open a pool.
    if (prop === 'then' || typeof prop === 'symbol') return undefined;
    const client = getClient();
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
