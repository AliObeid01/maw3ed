import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7: the CLI (migrate, generate) reads its connection from here. Migrations use the direct
// (non-pooled) URL; the runtime client in src/server/repositories/db.ts uses DATABASE_URL.
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '';

// `prisma generate` (postinstall, CI) needs no database. Everything that connects must have a URL.
const needsDatabase = ['migrate', 'db', 'studio'].includes(process.argv[2] ?? '');
if (needsDatabase && !url) {
  throw new Error(
    'DIRECT_URL (or DATABASE_URL) is not set. Copy .env.example to .env and fill it in before running prisma migrate/db commands.',
  );
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: { url },
});
