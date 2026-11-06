/** Staff activation link lifetime: 72 hours (same as a staff e-mail invite). */
export const ACTIVATION_TTL_MS = 72 * 3_600_000;

export const activationExpiry = (now: Date): Date => new Date(now.getTime() + ACTIVATION_TTL_MS);
