/* eslint-disable @typescript-eslint/no-explicit-any -- wraps the untyped pg query overloads */
import { Client } from 'pg';
import { vi } from 'vitest';

/**
 * Count the SQL statements that reach Postgres while `fn` runs. The app's Prisma driver adapter sends every
 * statement (model query, `$queryRaw`, BEGIN/COMMIT) through `pg.Client#query`, so this sees all of them.
 * Use it only around one call; the test's own pg client must be idle meanwhile. Returns the SQL texts too.
 */
export async function countStatements<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; statements: string[] }> {
  const statements: string[] = [];
  const original = Client.prototype.query as any;
  const spy = vi.spyOn(Client.prototype as any, 'query').mockImplementation(function (
    this: unknown,
    ...args: any[]
  ) {
    const first = args[0];
    statements.push(typeof first === 'string' ? first : String(first?.text ?? ''));
    return original.apply(this, args);
  });
  try {
    return { result: await fn(), statements };
  } finally {
    spy.mockRestore();
  }
}
