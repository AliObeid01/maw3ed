import { DateTime } from 'luxon';

/** Offers go to this many entries at a time (FR-19); the expiry job offers the next batch (FR-20). */
export const OFFER_BATCH_SIZE = 3;
/** How long one offer stays claimable. */
export const OFFER_TTL_MIN = 30;

export interface Candidate {
  entryId: string;
  clientId: string;
  /** null = any staff member. */
  staffId: string | null;
  /** Local calendar dates 'yyyy-MM-dd' in the business timezone, inclusive. */
  fromDate: string;
  toDate: string;
  createdAt: Date;
}

export interface FreedSlotRef {
  staffId: string;
  startAt: Date;
  timezone: string;
}

/**
 * Which OPEN entries (already filtered to the freed appointment's service) get an offer, in order.
 * Pure: `now` and every set are injected. The date range is compared as LOCAL dates in the business
 * timezone, so DST days (23 h / 25 h) cannot shift a slot into the wrong day.
 */
export function matchEntries(input: {
  slot: FreedSlotRef;
  candidates: Candidate[];
  now: Date;
  /** Clients that must not be offered the slot (the one who just cancelled). */
  excludeClientIds: ReadonlySet<string>;
  /** Clients that already hold an active appointment overlapping the slot. */
  busyClientIds: ReadonlySet<string>;
  /** Entries that already received an offer for this freed slot (any batch). */
  alreadyOfferedEntryIds: ReadonlySet<string>;
  limit?: number;
}): Candidate[] {
  const slotDate = DateTime.fromMillis(input.slot.startAt.getTime(), {
    zone: input.slot.timezone,
  }).toISODate()!;
  const today = DateTime.fromMillis(input.now.getTime(), {
    zone: input.slot.timezone,
  }).toISODate()!;
  return input.candidates
    .filter(
      (c) =>
        c.fromDate <= slotDate &&
        slotDate <= c.toDate &&
        c.toDate >= today &&
        (c.staffId === null || c.staffId === input.slot.staffId) &&
        !input.excludeClientIds.has(c.clientId) &&
        !input.busyClientIds.has(c.clientId) &&
        !input.alreadyOfferedEntryIds.has(c.entryId),
    )
    .sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0),
    )
    .slice(0, input.limit ?? OFFER_BATCH_SIZE);
}

/**
 * `expiresAt = min(now + 30 min, slotStart - minNotice)`, or null when the slot is already inside the
 * minimum notice (or in the past): nothing can be offered or claimed any more.
 */
export function offerExpiryFor(now: Date, slotStart: Date, minNoticeMin: number): Date | null {
  const cutoff = slotStart.getTime() - minNoticeMin * 60_000;
  if (cutoff <= now.getTime()) return null;
  return new Date(Math.min(now.getTime() + OFFER_TTL_MIN * 60_000, cutoff));
}
