import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7: the CLI (migrate, generate) reads its connection from here. Migrations use the direct
// (non-pooled) URL; the runtime client in src/server/repositories/db.ts uses DATABASE_URL.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
  },
});
