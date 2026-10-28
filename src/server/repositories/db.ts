import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

/**
 * The only Prisma client in the app. Only files under src/server/repositories may import this.
 * Runtime uses DATABASE_URL (pooled on Neon); migrations use DIRECT_URL via prisma.config.ts.
 */
function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

const globalForDb = globalThis as unknown as { __maw3edDb?: PrismaClient };

export const db: PrismaClient = (globalForDb.__maw3edDb ??= createClient());
