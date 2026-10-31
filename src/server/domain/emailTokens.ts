/** Lifetimes of the single-use account e-mail tokens. Pure: callers inject `now`. */
export type EmailTokenKind = 'VERIFY' | 'RESET';

const HOUR_MS = 60 * 60 * 1000;

export const EMAIL_TOKEN_TTL_MS: Record<EmailTokenKind, number> = {
  /** Verify-your-address links are not urgent: a day. */
  VERIFY: 24 * HOUR_MS,
  /** A reset link is a password: one hour. */
  RESET: HOUR_MS,
};

export const emailTokenExpiry = (kind: EmailTokenKind, now: Date): Date =>
  new Date(now.getTime() + EMAIL_TOKEN_TTL_MS[kind]);

/** Unused and strictly before its expiry instant. */
export const emailTokenUsable = (
  token: { expiresAt: Date; usedAt: Date | null },
  now: Date,
): boolean => token.usedAt === null && token.expiresAt.getTime() > now.getTime();
