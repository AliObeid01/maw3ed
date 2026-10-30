/** Deposit rules (FR-26). Pure: no clock, no I/O. */

/** A PENDING_PAYMENT appointment holds its slot for this long. */
export const DEPOSIT_HOLD_MS = 15 * 60_000;

export interface DepositInput {
  enabled: boolean;
  /** Past no-shows needed before a deposit is asked. */
  threshold: number;
  /** The client's no-show counter (matched by E.164 phone within the business). */
  noShows: number;
  source: 'PUBLIC' | 'FRONT_DESK' | 'WAITLIST';
}

/**
 * Does this booking need a deposit? Front-desk bookings never do (staff decide). A threshold below 1 is
 * treated as 1, so a client with a clean record is never charged.
 */
export function depositRequired(i: DepositInput): boolean {
  if (!i.enabled || i.source === 'FRONT_DESK') return false;
  return i.noShows >= Math.max(1, i.threshold);
}

export const holdExpiresAtFor = (now: Date): Date => new Date(now.getTime() + DEPOSIT_HOLD_MS);

/** A hold is live strictly before its expiry instant. */
export const holdIsLive = (holdExpiresAt: Date | null, now: Date): boolean =>
  holdExpiresAt !== null && now.getTime() < holdExpiresAt.getTime();
