/**
 * The only dashboard pages a PRACTITIONER (barber login) may open: their own Today, the outcome queue, one of their
 * appointments (the server answers 404 for anyone else's) and the account page. Everything else is the owner's.
 * Exact patterns, not prefixes, so a new page is denied until it is added here on purpose.
 */
const ALLOWED: readonly RegExp[] = [
  /^\/app\/today$/,
  /^\/app\/outcomes$/,
  /^\/app\/appointments\/[A-Za-z0-9_-]+$/,
  /^\/app\/account$/,
];

/** Where a barber lands: signing in, `/app` and every page that is not theirs lead here. */
export const PRACTITIONER_HOME = '/app/today';

export function practitionerMayView(pathname: string): boolean {
  const path = pathname.split('?')[0]!.replace(/\/+$/, '');
  return ALLOWED.some((pattern) => pattern.test(path));
}

export type PractitionerGate =
  | { kind: 'allow' }
  | { kind: 'redirect'; to: string }
  /** The page is unknown, so nothing can be allowed and a redirect could loop: render a closed state. */
  | { kind: 'forbidden' };

/**
 * The one decision behind both guards (the layout and every server page). Fails CLOSED: a barber whose current page
 * is unknown gets `forbidden`, never `allow`.
 */
export function practitionerGate(
  role: string,
  pathname: string | null | undefined,
): PractitionerGate {
  if (role !== 'PRACTITIONER') return { kind: 'allow' };
  if (!pathname) return { kind: 'forbidden' };
  return practitionerMayView(pathname)
    ? { kind: 'allow' }
    : { kind: 'redirect', to: PRACTITIONER_HOME };
}
