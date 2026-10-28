import { ApiError } from '@/lib/api/auth';

/** Keys under `auth.errors` for banners and for server-detected field problems. */
export type BannerKey =
  'invalidCredentials' | 'tooManyAttempts' | 'network' | 'generic' | 'fixFields';
export type ServerFieldKey = 'slugTaken' | 'emailTaken';

/** A field error is either one of our translated keys or raw text the server sent for that field. */
export type FieldMessage = { key: ServerFieldKey } | { text: string };

export type ClassifiedError = {
  fields: Record<string, FieldMessage>;
  banner?: BannerKey;
};

/**
 * Turns an API failure into what the form shows: messages on known fields, plus a banner for
 * everything that is not tied to a field. `knownFields` are the inputs the form actually has;
 * a server field we do not render would otherwise vanish silently, so it triggers the banner.
 */
export function classifyAuthError(error: unknown, knownFields: readonly string[]): ClassifiedError {
  if (!(error instanceof ApiError)) return { fields: {}, banner: 'generic' };

  switch (error.code) {
    case 'NETWORK':
      return { fields: {}, banner: 'network' };
    case 'INVALID_CREDENTIALS':
      // One generic message: never reveal which of email or password was wrong.
      return { fields: {}, banner: 'invalidCredentials' };
    case 'TOO_MANY_ATTEMPTS':
      return { fields: {}, banner: 'tooManyAttempts' };
    case 'SLUG_TAKEN':
      return knownFields.includes('slug')
        ? { fields: { slug: { key: 'slugTaken' } } }
        : { fields: {}, banner: 'generic' };
    case 'EMAIL_TAKEN':
      return knownFields.includes('email')
        ? { fields: { email: { key: 'emailTaken' } } }
        : { fields: {}, banner: 'generic' };
    case 'VALIDATION_FAILED':
      return mapServerFields(error.fields, knownFields);
    default:
      return { fields: {}, banner: 'generic' };
  }
}

/** Maps `fields` from a 400 to per-input messages; unknown field names or an empty map give the banner. */
export function mapServerFields(
  fields: Record<string, string>,
  knownFields: readonly string[],
): ClassifiedError {
  const mapped: Record<string, FieldMessage> = {};
  let hasUnmapped = false;
  for (const [name, text] of Object.entries(fields)) {
    if (knownFields.includes(name)) mapped[name] = { text };
    else hasUnmapped = true;
  }
  if (Object.keys(mapped).length === 0) return { fields: {}, banner: 'generic' };
  return hasUnmapped ? { fields: mapped, banner: 'fixFields' } : { fields: mapped };
}
