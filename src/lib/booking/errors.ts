import { ApiError } from '@/lib/api/auth';
import { slotsFromConflict, type Slot } from '@/lib/api/booking';
import { phoneLooksComplete } from './phone';

export type DetailsField = 'name' | 'phone' | 'email';
export const NAME_MAX = 80;
export const PHONE_MAX = 32;
export type DetailsErrors = Partial<
  Record<
    DetailsField,
    'nameRequired' | 'nameTooLong' | 'phoneInvalid' | 'emailRequired' | 'emailInvalid'
  >
>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Checks the details form before sending. The server validates again; this only saves a round trip.
 * `requireEmail` is true only on the public booking page (F68); the front desk keeps the email optional.
 */
export function validateDetails(
  input: {
    name: string;
    dial: string;
    phone: string;
    email: string;
  },
  opts: { requireEmail?: boolean } = {},
): DetailsErrors {
  const errors: DetailsErrors = {};
  if (input.name.trim().length === 0) errors.name = 'nameRequired';
  else if (input.name.trim().length > NAME_MAX) errors.name = 'nameTooLong';
  if (!phoneLooksComplete(input.dial, input.phone)) errors.phone = 'phoneInvalid';
  const email = input.email.trim();
  if (!email) {
    if (opts.requireEmail) errors.email = 'emailRequired';
  } else if (!EMAIL.test(email)) errors.email = 'emailInvalid';
  return errors;
}

/** Keys under `booking.errors` for banners. */
export type BookingBanner = 'network' | 'tooMany' | 'generic' | 'notFound' | 'fixFields';

export type BookingFailure =
  /** The slot was booked by someone else; `slots` are the fresh slots of that local day. */
  | { kind: 'slotTaken'; slots: Slot[] }
  | {
      kind: 'failed';
      fields: DetailsErrors;
      banner: BookingBanner;
      /** Drop the Idempotency-Key: it can no longer be reused for what the user sends next. */
      newAttempt: boolean;
    };

const FIELD_ERRORS: Record<DetailsField, NonNullable<DetailsErrors[DetailsField]>> = {
  name: 'nameRequired',
  phone: 'phoneInvalid',
  email: 'emailInvalid',
};

/**
 * Maps a failed booking request to what the screen shows. Server text is never displayed (it is English only):
 * every outcome becomes a translated key. A network error or 5xx keeps the same attempt (same key) so a retry
 * cannot double book.
 */
export function classifyBookingError(error: unknown): BookingFailure {
  if (!(error instanceof ApiError)) {
    return { kind: 'failed', fields: {}, banner: 'generic', newAttempt: false };
  }
  if (error.status === 409 && error.code === 'SLOT_TAKEN') {
    return { kind: 'slotTaken', slots: slotsFromConflict(error) };
  }
  if (error.code === 'NETWORK') {
    return { kind: 'failed', fields: {}, banner: 'network', newAttempt: false };
  }
  if (error.status === 429) {
    return { kind: 'failed', fields: {}, banner: 'tooMany', newAttempt: false };
  }
  if (error.status === 404) {
    return { kind: 'failed', fields: {}, banner: 'notFound', newAttempt: true };
  }
  if (error.status === 400) {
    const fields: DetailsErrors = {};
    let other = false;
    for (const name of Object.keys(error.fields)) {
      const match = /^client\.(name|phone|email)$/.exec(name);
      if (match) {
        const field = match[1] as DetailsField;
        // The server text is English only, but its length complaint is how a too-long name is told apart from an empty one.
        const tooLong =
          field === 'name' && /\b80\b|<=|at most|too (long|big)/i.test(error.fields[name] ?? '');
        const missing =
          field === 'email' && /required|>=1|too small|received undefined/i.test(error.fields[name] ?? '');
        fields[field] = tooLong ? 'nameTooLong' : missing ? 'emailRequired' : FIELD_ERRORS[field];
      }
      else other = true;
    }
    if (Object.keys(fields).length > 0 && !other) {
      return { kind: 'failed', fields, banner: 'fixFields', newAttempt: false };
    }
    return { kind: 'failed', fields, banner: 'generic', newAttempt: true };
  }
  // 422 IDEMPOTENCY_KEY_REUSED and other 4xx: this key is spent. 5xx and the rest: same attempt, retry is safe.
  const spent = error.status >= 400 && error.status < 500;
  return { kind: 'failed', fields: {}, banner: 'generic', newAttempt: spent };
}
