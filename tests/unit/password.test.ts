import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifySpy = vi.hoisted(() => vi.fn());
vi.mock('@node-rs/argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@node-rs/argon2')>();
  verifySpy.mockImplementation(actual.verify);
  return { ...actual, verify: verifySpy };
});

import { hashPassword, verifyPassword } from '@/server/services/password';

beforeEach(() => {
  verifySpy.mockClear();
});

describe('passwords', () => {
  it('hashes with argon2id and verifies the right password only', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong password!!', h)).toBe(false);
  });

  it('does the same verification work when the user does not exist (timing path)', async () => {
    expect(await verifyPassword('whatever-password', null)).toBe(false);
    expect(await verifyPassword('whatever-password', undefined)).toBe(false);
    // Each missing-user call still runs a full argon2 verify against the dummy hash.
    expect(verifySpy).toHaveBeenCalledTimes(2);
    const [dummy] = verifySpy.mock.calls[0]!;
    expect(String(dummy)).toMatch(/^\$argon2id\$/);
  });

  it('treats a corrupt stored hash as a failed login, not a crash', async () => {
    expect(await verifyPassword('x'.repeat(12), 'not-a-hash')).toBe(false);
  });
});
