import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type GlobalDb = { __maw3edDb?: unknown };

describe('lazy Prisma client', () => {
  const saved = process.env.DATABASE_URL;
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete (globalThis as GlobalDb).__maw3edDb;
    vi.resetModules();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
    delete (globalThis as GlobalDb).__maw3edDb;
  });

  it('can be imported without DATABASE_URL', async () => {
    await expect(import('@/server/repositories/db')).resolves.toHaveProperty('db');
    expect((globalThis as GlobalDb).__maw3edDb).toBeUndefined();
  });

  it('does not create a client when awaited or inspected via symbols', async () => {
    const { db } = await import('@/server/repositories/db');
    await expect(Promise.resolve(db)).resolves.toBe(db);
    expect(await db).toBe(db);
    expect(Reflect.get(db, Symbol.toPrimitive)).toBeUndefined();
    expect(Reflect.get(db, 'then')).toBeUndefined();
    expect((globalThis as GlobalDb).__maw3edDb).toBeUndefined();
  });

  it('fails with the clear error when a query member is used without DATABASE_URL', async () => {
    const { db } = await import('@/server/repositories/db');
    expect(() => db.appointment).toThrow('DATABASE_URL is not set');
    expect(() => 'appointment' in db).toThrow('DATABASE_URL is not set');
  });

  it('forwards has, ownKeys and prototype to the real client once a URL exists', async () => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/none';
    const { db } = await import('@/server/repositories/db');
    expect('$connect' in db).toBe(true);
    expect('definitelyNotAModel' in db).toBe(false);
    const real = (globalThis as GlobalDb).__maw3edDb as object;
    expect(real).toBeDefined();
    expect(Object.getPrototypeOf(db)).toBe(Object.getPrototypeOf(real));
    expect(Reflect.ownKeys(db).length).toBeGreaterThan(0);
  });
});
