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

export function isValidTimezone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
