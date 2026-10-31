export type OfferStatusIn = 'OPEN' | 'CLAIMED' | 'EXPIRED' | 'SUPERSEDED';
export type EntryStatusIn = 'OPEN' | 'FULFILLED' | 'CANCELLED';

/**
 * What an offer link tells its holder. Derived from the offer status AND the status of its waitlist
 * entry, so no state blames "someone else" unless the slot really went to someone else:
 *  - TAKEN: the slot went to someone else (the client is still waiting).
 *  - UNAVAILABLE: the client left the waitlist (or staff removed the entry).
 *  - ALREADY_BOOKED: this same request already holds a booking made through another offer.
 */
export type OfferViewStatus =
  | 'OPEN'
  | 'CLAIMED'
  | 'EXPIRED'
  | 'TAKEN'
  | 'UNAVAILABLE'
  | 'ALREADY_BOOKED';

export function offerViewStatus(offer: OfferStatusIn, entry: EntryStatusIn): OfferViewStatus {
  if (offer === 'CLAIMED' || offer === 'EXPIRED') return offer;
  if (entry === 'CANCELLED') return 'UNAVAILABLE';
  if (entry === 'FULFILLED') return 'ALREADY_BOOKED';
  return offer === 'SUPERSEDED' ? 'TAKEN' : 'OPEN';
}
