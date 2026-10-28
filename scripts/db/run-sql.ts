import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

// Tiny psql stand-in: runs a .sql file against DIRECT_URL (or DATABASE_URL) and prints every result set and notice.
// Usage: tsx scripts/db/run-sql.ts scripts/db/check-constraints.sql
const file = process.argv[2];
if (!file) {
  console.error('usage: tsx scripts/db/run-sql.ts <file.sql>');
  process.exit(2);
}

const client = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
client.on('notice', (n) => console.log(`NOTICE: ${n.message}`));

try {
  await client.connect();
  const results = await client.query(readFileSync(file, 'utf8'));
  for (const r of Array.isArray(results) ? results : [results]) {
    if (r.command === 'SELECT') {
      console.log(`-- ${r.rowCount} row(s)`);
      console.table(r.rows);
    }
  }
} catch (error) {
  console.error(`FAILED: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
