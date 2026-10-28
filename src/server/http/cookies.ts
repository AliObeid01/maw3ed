const isProd = () => process.env.NODE_ENV === 'production';

/**
 * Cookie name. Production uses the `__Host-` prefix, which browsers only accept when the cookie is
 * Secure, has Path=/ and no Domain (all true here). Development has no HTTPS, so it keeps the plain name.
 */
export const sessionCookieName = () => (isProd() ? '__Host-maw3ed_session' : 'maw3ed_session');
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Sliding expiry is extended at most this often. */
export const SESSION_REFRESH_AFTER_MS = 60 * 60 * 1000;

/** Set-Cookie value for the session: httpOnly, SameSite=Lax, Path=/, Secure in production. */
export function sessionCookie(token: string, expiresAt: Date, now: Date = new Date()): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
  return [
    `${sessionCookieName()}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    `Expires=${expiresAt.toUTCString()}`,
    ...(isProd() ? ['Secure'] : []),
  ].join('; ');
}

export function clearSessionCookie(): string {
  return [
    `${sessionCookieName()}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ...(isProd() ? ['Secure'] : []),
  ].join('; ');
}

/** Pull the session token out of a Cookie header. Returns undefined when absent or empty. */
export function readSessionToken(cookieHeader: string | null | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== sessionCookieName()) continue;
    const value = part.slice(index + 1).trim();
    return value || undefined;
  }
  return undefined;
}
