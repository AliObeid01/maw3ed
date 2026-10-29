import { ApiError } from '@/lib/api/auth';
import { NAME_MAX, validateDetails } from '@/lib/booking/errors';
import { validateRange, type RangeProblem } from './range';

/** Loose shape check; the server is the judge. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type JoinField = 'service' | 'staff' | 'from' | 'to' | 'name' | 'phone' | 'email';

/** Keys under `waitlist.errors` for one field. */
export type JoinFieldError =
  | 'serviceRequired'
  | 'staffInvalid'
  | RangeProblem
  | 'toOutOfWindow'
  | 'nameRequired'
  | 'nameTooLong'
  | 'phoneInvalid'
  | 'emailRequired'
  | 'emailInvalid';
export type JoinErrors = Partial<Record<JoinField, JoinFieldError>>;

export type JoinInput = {
  serviceId: string;
  from: string;
  to: string;
  name: string;
  dial: string;
  phone: string;
  email: string;
};

/** Checks the form before sending. The server validates again; this only saves a round trip. */
export function validateJoin(input: JoinInput, now: Date, timezone: string): JoinErrors {
  const errors: JoinErrors = {};
  if (!input.serviceId) errors.service = 'serviceRequired';
  const range = validateRange({ from: input.from, to: input.to }, now, timezone);
  if (range.from) errors.from = range.from;
  if (range.to) errors.to = range.to;
  const details = validateDetails({ name: input.name, dial: input.dial, phone: input.phone, email: '' });
  if (details.name === 'nameRequired' || details.name === 'nameTooLong') errors.name = details.name;
  if (details.phone) errors.phone = 'phoneInvalid';
  const email = input.email.trim();
  if (!email) errors.email = 'emailRequired';
  else if (!EMAIL_PATTERN.test(email)) errors.email = 'emailInvalid';
  return errors;
}

/** Keys under `waitlist.banner`. */
export type JoinBanner = 'network' | 'tooMany' | 'generic' | 'notFound' | 'fixFields';

export type JoinFailure =
  /** 409 WAITLIST_LIMIT: this person already has the maximum number of open entries. */
  | { kind: 'limit' }
  | { kind: 'failed'; fields: JoinErrors; banner: JoinBanner };

const SERVER_FIELDS: Record<string, { field: JoinField; error: JoinFieldError }> = {
  serviceId: { field: 'service', error: 'serviceRequired' },
  staffId: { field: 'staff', error: 'staffInvalid' },
  fromDate: { field: 'from', error: 'fromPast' },
  toDate: { field: 'to', error: 'toOutOfWindow' },
  'client.name': { field: 'name', error: 'nameRequired' },
  'client.phone': { field: 'phone', error: 'phoneInvalid' },
  'client.email': { field: 'email', error: 'emailInvalid' },
};

/**
 * Maps a failed join to what the screen shows. Server text is English only and never displayed: every outcome
 * is a translated key. A field the form has no input for turns the whole failure into a generic banner.
 */
export function classifyJoinError(error: unknown): JoinFailure {
  if (!(error instanceof ApiError)) return { kind: 'failed', fields: {}, banner: 'generic' };
  if (error.status === 409 && error.code === 'WAITLIST_LIMIT') return { kind: 'limit' };
  if (error.code === 'NETWORK') return { kind: 'failed', fields: {}, banner: 'network' };
  if (error.status === 429) return { kind: 'failed', fields: {}, banner: 'tooMany' };
  if (error.status === 404) return { kind: 'failed', fields: {}, banner: 'notFound' };
  if (error.status === 400) {
    const fields: JoinErrors = {};
    let other = false;
    for (const [name, text] of Object.entries(error.fields)) {
      const known = SERVER_FIELDS[name];
      if (!known) {
        other = true;
        continue;
      }
      if (known.field === 'name') {
        // The server's length complaint is how a too-long name is told apart from an empty one.
        fields.name = new RegExp(`\\b${NAME_MAX}\\b|<=|too big`, 'i').test(text) ? 'nameTooLong' : 'nameRequired';
      } else if (known.field === 'email') {
        // A missing email (the field is required) reads differently from a malformed one.
        fields.email = /required|>=1|too small|received undefined/i.test(text) ? 'emailRequired' : 'emailInvalid';
      } else {
        fields[known.field] = known.error;
      }
    }
    if (Object.keys(fields).length > 0 && !other) return { kind: 'failed', fields, banner: 'fixFields' };
    return { kind: 'failed', fields, banner: 'generic' };
  }
  return { kind: 'failed', fields: {}, banner: 'generic' };
}
