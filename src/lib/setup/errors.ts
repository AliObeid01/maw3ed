import { ApiError } from '@/lib/api/auth';

export type SetupErrorKey =
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'notFound'
  | 'validation'
  | 'hasFutureAppointments'
  | 'rateLimited'
  | 'server'
  | 'generic';

/** Maps any thrown value to a translation key. The server's own message text is never shown. */
export function errorKey(error: unknown): SetupErrorKey {
  if (!(error instanceof ApiError)) return 'generic';
  if (error.code === 'NETWORK') return 'network';
  if (error.code === 'HAS_FUTURE_APPOINTMENTS') return 'hasFutureAppointments';
  if (error.status === 401) return 'unauthorized';
  if (error.status === 403) return 'forbidden';
  if (error.status === 404) return 'notFound';
  if (error.status === 429) return 'rateLimited';
  if (error.status === 400) return 'validation';
  if (error.status >= 500 || error.code === 'BAD_RESPONSE') return 'server';
  return 'generic';
}

/** Field names the server flagged on a 400 (empty for any other error). */
export function invalidFields(error: unknown): string[] {
  return error instanceof ApiError && error.status === 400 ? Object.keys(error.fields) : [];
}
