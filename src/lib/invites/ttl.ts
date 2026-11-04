/**
 * Staff invite lifetime. Lives outside src/server so client components can show it;
 * the invites service re-exports the millisecond value. Change it here only.
 */
export const INVITE_TTL_DAYS = 3;
export const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;
