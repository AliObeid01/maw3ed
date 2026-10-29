import { IANAZone } from 'luxon';

export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'app',
  'api',
  'b',
  'l',
  'o',
  'pay',
  'pricing',
  'login',
  'logout',
  'signup',
  'invite',
  'invites',
  'directory',
  'explore',
  'admin',
  'www',
  'static',
  '_next',
  'me',
  'dashboard',
  'settings',
  'help',
  'support',
  'about',
  'terms',
  'privacy',
  'health',
  'assets',
  'public',
  'mail',
  'status',
  'maw3ed',
]);

const SLUG_FORMAT = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

export type SlugProblem = 'invalid' | 'reserved';

/** Format and reserved-word check (availability is a database question). Slugs are lowercase already. */
export function slugProblem(slug: string): SlugProblem | undefined {
  if (!SLUG_FORMAT.test(slug)) return 'invalid';
  if (RESERVED_SLUGS.has(slug)) return 'reserved';
  return undefined;
}

let canonicalZones: ReadonlySet<string> | undefined;

/**
 * Only canonical IANA names: exact case ('asia/beirut' is rejected), no offsets ('+03:00'), no aliases the
 * runtime does not list. Changing a business timezone later reinterprets stored local working hours.
 */
export function isValidTimezone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  canonicalZones ??= new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);
  if (!canonicalZones.has(tz)) return false;
  return IANAZone.isValidZone(tz);
}
