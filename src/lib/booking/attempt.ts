import type { BookingBody } from '@/lib/api/booking';

/**
 * What makes a booking "the same attempt". This mirrors the server's own replay check (service, staff, start and
 * phone, see sameBookingRequest): a typo fix in the name or email after a lost response must reuse the key, so the
 * server replays the first booking instead of answering 422 or booking twice.
 */
export function attemptFingerprint(body: BookingBody): string {
  return JSON.stringify([body.serviceId, body.staffId, body.startAt, body.client.phone]);
}

/**
 * `Idempotency-Key` lifecycle. One key per booking attempt: retrying the same booking (network failure,
 * a double tap, a 5xx) reuses it so the server returns the first result instead of booking twice; changing
 * the slot, the service, the person or the phone starts a new attempt with a new key (the server answers 422 if a
 * key is reused for a different booking).
 */
export function createAttemptKeys(generate: () => string = () => `bk-${crypto.randomUUID()}`) {
  let fingerprint: string | undefined;
  let key: string | undefined;
  return {
    keyFor(body: BookingBody): string {
      const next = attemptFingerprint(body);
      if (key === undefined || next !== fingerprint) {
        fingerprint = next;
        key = generate();
      }
      return key;
    },
    /** Forget the key (after a 422, or once the booking is done). */
    reset() {
      fingerprint = undefined;
      key = undefined;
    },
  };
}
