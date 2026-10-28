import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes, base64url: used for session and invite tokens. Only the sha256 is stored. */
export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
