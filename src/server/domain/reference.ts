/**
 * Booking reference: a short code a client can read out on the phone ("my reference is K7M2QX").
 *
 * It is NOT a secret and NOT an authentication token: it never lets anyone view or change a booking. It is
 * only a label shown on the booked page, the booking e-mail, the client link page and the staff screen.
 *
 * Pure: the random source is injected (the repository passes `crypto.randomInt`).
 */

/** 31 characters. No O, 0, I, 1 or L: they are mistaken for each other when spoken or handwritten. */
export const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const REFERENCE_LENGTH = 6;

/** Name of the unique index on `Appointment.reference`. The booking path tells a collision apart by it. */
export const REFERENCE_INDEX = 'Appointment_reference_key';

/** `randomInt(max)` returns an integer in [0, max). */
export function generateReference(randomInt: (max: number) => number): string {
  let out = '';
  for (let i = 0; i < REFERENCE_LENGTH; i++)
    out += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return out;
}

export const isReference = (value: string): boolean =>
  value.length === REFERENCE_LENGTH && [...value].every((c) => REFERENCE_ALPHABET.includes(c));
