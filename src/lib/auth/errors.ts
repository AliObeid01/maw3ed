import { ApiError } from '@/lib/api/auth';

/** Keys under `auth.errors` for banners. */
export type BannerKey =
  | 'invalidCredentials'
  | 'inviteWrongPassword'
  | 'alreadyMember'
  | 'tooManyAttempts'
  | 'network'
  | 'generic'
  | 'fixFields';
/** Keys under `auth.errors` for problems the server found on a field. */
export type ServerFieldKey =
  'slugTaken' | 'slugReserved' | 'emailTaken' | 'passwordShort' | 'invalidField';

export type FieldMessage = { key: ServerFieldKey };

export type ClassifiedError = {
  fields: Record<string, FieldMessage>;
  banner?: BannerKey;
  /** The resource is gone (404): the invite was used or expired after the page loaded. */
  gone?: boolean;
};

export type ErrorContext = 'default' | 'invite';

/**
 * Turns an API failure into what the form shows: messages on known fields, plus a banner for
 * everything that is not tied to a field. `knownFields` are the inputs the form actually has;
 * a server field we do not render would otherwise vanish silently, so it triggers the banner.
 * Server field text is never shown (it is English only); it maps to our translated keys.
 */
export function classifyAuthError(
  error: unknown,
  knownFields: readonly string[],
  context: ErrorContext = 'default',
): ClassifiedError {
  if (!(error instanceof ApiError)) return { fields: {}, banner: 'generic' };

  switch (error.code) {
    case 'NETWORK':
      return { fields: {}, banner: 'network' };
    case 'INVALID_CREDENTIALS':
      // One generic message: never reveal which of email or password was wrong.
      return {
        fields: {},
        banner: context === 'invite' ? 'inviteWrongPassword' : 'invalidCredentials',
      };
    case 'TOO_MANY_ATTEMPTS':
      return { fields: {}, banner: 'tooManyAttempts' };
    case 'ALREADY_MEMBER':
      return { fields: {}, banner: 'alreadyMember' };
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
      return error.status === 404
        ? { fields: {}, banner: 'generic', gone: true }
        : { fields: {}, banner: 'generic' };
  }
}

/** Maps `fields` from a 400 to per-input messages (translated keys) plus the "fix the highlighted fields" banner. */
export function mapServerFields(
  fields: Record<string, string>,
  knownFields: readonly string[],
): ClassifiedError {
  const mapped: Record<string, FieldMessage> = {};
  for (const name of Object.keys(fields)) {
    if (!knownFields.includes(name)) continue;
    // The only password rule the server enforces on a body we already checked is the minimum.
    mapped[name] = { key: name === 'password' ? 'passwordShort' : 'invalidField' };
  }
  if (Object.keys(mapped).length === 0) return { fields: {}, banner: 'generic' };
  return { fields: mapped, banner: 'fixFields' };
}
