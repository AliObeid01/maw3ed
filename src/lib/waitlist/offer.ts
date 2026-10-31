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
  /** The client left the waitlist (or staff removed the entry): the request is no longer active. */
  | 'unavailable'
  /** Another offer of this same waitlist request was claimed: the client already holds a booking. */
  | 'alreadyBooked'
  /** The client's own deposit time ran out; the slot was released, they are still on the waitlist. */
  | 'holdLapsed';

/** Milliseconds until the offer ends; 0 once `now` reaches `expiresAt` (exactly at expiry counts as over). */
export function msLeft(expiresAt: string, nowMs: number): number {
  return Math.max(0, Date.parse(expiresAt) - nowMs);
}

export const isExpired = (expiresAt: string, nowMs: number) => msLeft(expiresAt, nowMs) === 0;

/** Whole minutes left, rounded up so "1 min" shows until the last second; 0 once expired. */
export function minutesLeft(expiresAt: string, nowMs: number): number {
  return Math.ceil(msLeft(expiresAt, nowMs) / 60_000);
}

/**
 * True when the (server-corrected) clock has reached expiry. This alone never ends the offer: the server's
 * canClaim and its answer to a tap decide. The page uses it to disable Book and show the expiry text.
 */
export const clockSaysEnded = isExpired;

/**
 * Derives the screen from the API view. The clock is only consulted once the server has already said the offer
 * cannot be claimed (an OPEN offer with canClaim false and a passed expiry is an expired offer, not a broken one).
 */
export function offerScreen(view: Pick<OfferView, 'offer' | 'canClaim'>, serverNowMs: number): OfferScreen {
  switch (view.offer.status) {
    case 'EXPIRED':
      return 'expired';
    case 'TAKEN':
      return 'taken';
    case 'CLAIMED':
      return 'claimed';
    case 'UNAVAILABLE':
      return 'unavailable';
    case 'ALREADY_BOOKED':
      return 'alreadyBooked';
    case 'HOLD_LAPSED':
      return 'holdLapsed';
    default:
      if (view.canClaim) return 'open';
      return isExpired(view.offer.expiresAt, serverNowMs) ? 'expired' : 'unavailable';
  }
}

/** Which spoken announcement (if any) the hidden live region makes: only at 10, 5 and 1 minute and at expiry. */
export type Announcement = 'm10' | 'm5' | 'm1' | 'expired' | '';
export function announcementFor(expiresAt: string, nowMs: number): Announcement {
  const ms = msLeft(expiresAt, nowMs);
  if (ms === 0) return 'expired';
  if (ms <= 60_000) return 'm1';
  if (ms <= 5 * 60_000) return 'm5';
  if (ms <= 10 * 60_000) return 'm10';
  return '';
}

export type OfferFailure =
  | 'invalid'
  | 'expired'
  | 'taken'
  | 'unavailable'
  | 'alreadyBooked'
  | 'holdLapsed'
  | 'network'
  | 'tooMany'
  | 'generic';

/**
 * Maps a failed offer request (read or claim) to what the screen shows:
 * 404 = malformed or forged link, 410 = expired, 409 SLOT_TAKEN = someone else got it,
 * 409 ALREADY_BOOKED = this request already holds a booking, 409 HOLD_LAPSED = the deposit time ran out, any other 409 (WAITLIST_INACTIVE, CONFLICT) =
 * the waitlist request is no longer active.
 */
export function classifyOfferError(error: unknown): OfferFailure {
  if (!(error instanceof ApiError)) return 'generic';
  if (error.code === 'NETWORK') return 'network';
  if (error.status === 404 || error.status === 400) return 'invalid';
  if (error.status === 410) return 'expired';
  if (error.status === 409) {
    if (error.code === 'SLOT_TAKEN') return 'taken';
    if (error.code === 'HOLD_LAPSED') return 'holdLapsed';
    return error.code === 'ALREADY_BOOKED' ? 'alreadyBooked' : 'unavailable';
  }
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
