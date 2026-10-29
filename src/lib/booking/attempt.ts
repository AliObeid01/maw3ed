import type { BookingBody } from '@/lib/api/booking';

/** Everything that makes a booking "the same attempt": slot, service, staff and the client's details. */
export function attemptFingerprint(body: BookingBody): string {
  return JSON.stringify([
    body.serviceId,
    body.staffId,
    body.startAt,
    body.client.name,
    body.client.phone,
    body.client.email ?? '',
  ]);
}

/**
 * `Idempotency-Key` lifecycle. One key per booking attempt: retrying the same booking (network failure,
 * a double tap, a 5xx) reuses it so the server returns the first result instead of booking twice; changing
 * the slot or any detail starts a new attempt with a new key (the server answers 422 if a key is reused for
 * a different booking).
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
