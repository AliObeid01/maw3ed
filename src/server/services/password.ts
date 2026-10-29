import { hash, verify } from '@node-rs/argon2';
import { createSemaphore, type Semaphore } from './semaphore';

export const ARGON2_CONCURRENCY = 3;
export const ARGON2_MAX_WAIT_MS = 5000;

export interface Hasher {
  hash(plain: string): Promise<string>;
  verify(hash: string, plain: string): Promise<boolean>;
}

const libHasher: Hasher = { hash: (p) => hash(p), verify: (h, p) => verify(h, p) };

/** Per-instance cap on concurrent argon2 work (each hash is ~19 MiB and ~50 ms of CPU). */
let gate: Semaphore = createSemaphore(ARGON2_CONCURRENCY, ARGON2_MAX_WAIT_MS);
let hasher: Hasher = libHasher;

/** Test seam: swap the hasher and the semaphore; call with no arguments to restore the defaults. */
export function configurePasswordForTests(opts?: { hasher?: Hasher; gate?: Semaphore }) {
  hasher = opts?.hasher ?? libHasher;
  gate = opts?.gate ?? createSemaphore(ARGON2_CONCURRENCY, ARGON2_MAX_WAIT_MS);
  dummyHash = undefined;
}

/** argon2id with the library defaults (m=19456 KiB, t=2, p=1), which meet the OWASP minimum. */
export const hashPassword = (plain: string): Promise<string> => gate.run(() => hasher.hash(plain));

let dummyHash: Promise<string> | undefined;
/** A real hash of a throwaway secret, so "no such user" costs the same as "wrong password". */
const getDummyHash = () => (dummyHash ??= hasher.hash('maw3ed-dummy-password-for-timing'));

/**
 * Verify a password. When there is no hash (unknown user, or a password-less seeded user) a dummy hash
 * is verified instead so the timing does not reveal whether the account exists; the result is false.
 * Both paths take a slot in the same gate, so they queue (and time) identically.
 */
export async function verifyPassword(plain: string, passwordHash: string | null | undefined) {
  return gate.run(async () => {
    if (!passwordHash) {
      await hasher.verify(await getDummyHash(), plain).catch(() => false);
      return false;
    }
    try {
      return await hasher.verify(passwordHash, plain);
    } catch {
      return false;
    }
  });
}
