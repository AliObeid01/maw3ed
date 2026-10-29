import { ApiError } from '@/lib/api/auth';
import type { OfferView } from '@/lib/api/waitlist';

/** What the offer page shows for an offer. */
export type OfferScreen =
  /** Still claimable: the Book button is live. */
  | 'open'
  /** The 30-minute window ended (status EXPIRED, or the clock passed expiresAt). */
  | 'expired'
  /** Somebody else booked the slot (status TAKEN). */
  | 'taken'
  /** This offer was already claimed (by the person holding the link). */
  | 'claimed'
  /** Open but not claimable: the waitlist entry is no longer active. */
  | 'unavailable';

/** Milliseconds until the offer ends; 0 once `now` reaches `expiresAt` (exactly at expiry counts as over). */
export function msLeft(expiresAt: string, nowMs: number): number {
  return Math.max(0, Date.parse(expiresAt) - nowMs);
}

export const isExpired = (expiresAt: string, nowMs: number) => msLeft(expiresAt, nowMs) === 0;

/** Whole minutes left, rounded up so "1 min" shows until the last second; 0 once expired. */
export function minutesLeft(expiresAt: string, nowMs: number): number {
  return Math.ceil(msLeft(expiresAt, nowMs) / 60_000);
}

/** Derives the screen from the API view and the clock. The clock wins over a stale OPEN status. */
export function offerScreen(view: Pick<OfferView, 'offer' | 'canClaim'>, nowMs: number): OfferScreen {
  switch (view.offer.status) {
    case 'EXPIRED':
      return 'expired';
    case 'TAKEN':
      return 'taken';
    case 'CLAIMED':
      return 'claimed';
    default:
      if (isExpired(view.offer.expiresAt, nowMs)) return 'expired';
      return view.canClaim ? 'open' : 'unavailable';
  }
}

export type OfferFailure = 'invalid' | 'expired' | 'taken' | 'unavailable' | 'network' | 'tooMany' | 'generic';

/**
 * Maps a failed offer request (read or claim) to what the screen shows:
 * 404 = malformed or forged link, 410 = expired, 409 SLOT_TAKEN = someone else got it,
 * 409 CONFLICT = the waitlist entry is no longer open.
 */
export function classifyOfferError(error: unknown): OfferFailure {
  if (!(error instanceof ApiError)) return 'generic';
  if (error.code === 'NETWORK') return 'network';
  if (error.status === 404 || error.status === 400) return 'invalid';
  if (error.status === 410) return 'expired';
  if (error.status === 409) return error.code === 'SLOT_TAKEN' ? 'taken' : 'unavailable';
  if (error.status === 429) return 'tooMany';
  return 'generic';
}

/**
 * Runs `post` once at a time: a second call while one is in flight gets the same promise instead of sending
 * another request (a double tap on the Book button). The server replays a repeated claim, but the page should
 * not depend on that.
 */
export function createClaimRunner<T>(post: () => Promise<T>) {
  let inFlight: Promise<T> | undefined;
  return {
    run(): Promise<T> {
      inFlight ??= post().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
    isRunning: () => inFlight !== undefined,
  };
}
