/** Characters of the sha256 hash used as the public version in the logo URL. */
export const LOGO_VERSION_LENGTH = 16;

/**
 * Public URL of a business logo, or null when it has none. The version is the first 16 hex characters of the
 * stored image's sha256, so a replaced logo is a new URL (browser and CDN may cache the old one forever).
 */
export function logoUrlFor(slug: string, hash: string | null | undefined): string | null {
  if (!hash) return null;
  return `/api/public/${encodeURIComponent(slug)}/logo?v=${hash.slice(0, LOGO_VERSION_LENGTH)}`;
}
