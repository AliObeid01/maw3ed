import { hash, verify } from '@node-rs/argon2';

/** argon2id with the library defaults (m=19456 KiB, t=2, p=1), which meet the OWASP minimum. */
export const hashPassword = (plain: string): Promise<string> => hash(plain);

let dummyHash: Promise<string> | undefined;
/** A real hash of a throwaway secret, so "no such user" costs the same as "wrong password". */
const getDummyHash = () => (dummyHash ??= hash('maw3ed-dummy-password-for-timing'));

/**
 * Verify a password. When there is no hash (unknown user, or a password-less seeded user) a dummy hash
 * is verified instead so the timing does not reveal whether the account exists; the result is false.
 */
export async function verifyPassword(plain: string, passwordHash: string | null | undefined) {
  if (!passwordHash) {
    await verify(await getDummyHash(), plain).catch(() => false);
    return false;
  }
  try {
    return await verify(passwordHash, plain);
  } catch {
    return false;
  }
}
