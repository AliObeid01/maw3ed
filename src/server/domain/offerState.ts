export type OfferStatusIn = 'OPEN' | 'CLAIMED' | 'EXPIRED' | 'SUPERSEDED';
export type EntryStatusIn = 'OPEN' | 'FULFILLED' | 'CANCELLED';

/**
 * What an offer link tells its holder. Derived from the offer status AND the status of its waitlist
 * entry, so no state blames "someone else" unless the slot really went to someone else:
 *  - TAKEN: the slot went to someone else (the client is still waiting).
 *  - UNAVAILABLE: the client left the waitlist (or staff removed the entry).
 *  - ALREADY_BOOKED: this same request already holds a booking made through another offer.
 *  - HOLD_LAPSED: the client claimed this offer, did not pay the deposit in time and the hold was swept. The slot
 *    went back to the other waiters and is NOT offered to this client again; their entry stays on the waitlist.
 */
export type OfferViewStatus =
  | 'OPEN'
  | 'CLAIMED'
  | 'EXPIRED'
  | 'TAKEN'
  | 'UNAVAILABLE'
  | 'ALREADY_BOOKED'
  | 'HOLD_LAPSED';

export function offerViewStatus(
  offer: OfferStatusIn,
  entry: EntryStatusIn,
  holdLapsed = false,
): OfferViewStatus {
  if (offer === 'CLAIMED' || offer === 'EXPIRED') return offer;
  if (entry === 'CANCELLED') return 'UNAVAILABLE';
  if (entry === 'FULFILLED') return 'ALREADY_BOOKED';
  if (offer === 'SUPERSEDED') return 'TAKEN';
  return holdLapsed ? 'HOLD_LAPSED' : 'OPEN';
}
