import type { SavedBooking } from './storage';

/**
 * Rules for an unpaid deposit hold kept in "My bookings on this device". Pure: the clock is passed in.
 * The device clock is only a hint for the countdown; the server's answer (GET /api/links/{token}) decides
 * whether the booking is still PENDING_PAYMENT, and the pay page itself is the real authority.
 */

type HoldFields = Pick<SavedBooking, 'payToken' | 'holdExpiresAt' | 'ended'>;

/** Milliseconds left on the hold; 0 when there is none, it ended, or the entry was closed. */
export function holdMsLeft(entry: HoldFields, now: Date): number {
  if (!entry.payToken || !entry.holdExpiresAt || entry.ended) return 0;
  return Math.max(0, Date.parse(entry.holdExpiresAt) - now.getTime());
}

/** True while "Deposit due" and the Pay button may be shown. */
export function isHeld(entry: HoldFields, now: Date): boolean {
  return holdMsLeft(entry, now) > 0;
}

export type HoldThreshold = 'tmore' | 't5m' | 't2m' | 't1m' | 't30s' | 'expired';

/**
 * The coarse step the countdown is in. The visible clock ticks every second but is hidden from assistive
 * technology; a polite live region speaks only when this key changes.
 */
export function holdThresholdKey(msLeft: number): HoldThreshold {
  if (msLeft <= 0) return 'expired';
  if (msLeft <= 30_000) return 't30s';
  if (msLeft <= 60_000) return 't1m';
  if (msLeft <= 120_000) return 't2m';
  if (msLeft <= 300_000) return 't5m';
  return 'tmore';
}

/** mm:ss with Latin digits, rounded up so "0:00" only shows when the hold has really ended. */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** What the live link says about a held booking: only PENDING_PAYMENT is still held, anything else releases the hold. */
export const holdStillOpen = (status: string): boolean => status === 'PENDING_PAYMENT';
