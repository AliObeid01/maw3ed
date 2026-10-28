import { RESERVED_SLUGS } from '@/server/contracts/slug';

export const SLUG_MIN = 3;
export const SLUG_MAX = 40;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Turns a business name into a URL slug: lowercase, accents stripped, anything that is not a
 * letter or digit becomes one hyphen, trimmed and capped. Names with no Latin letters (for
 * example Arabic) give an empty string and the owner types the link themselves.
 */
export function suggestSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
}

/** What the owner may type in the slug box: lowercase letters, digits and hyphens (spaces become hyphens). */
export function normalizeSlugInput(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, SLUG_MAX);
}

/** Light client-side format check; the server (`/api/auth/slug-check`) stays authoritative. */
export function isValidSlugFormat(slug: string): boolean {
  return slug.length >= SLUG_MIN && slug.length <= SLUG_MAX && SLUG_RE.test(slug);
}

/** Same list as the server (imported from its pure contract module, so it cannot drift). */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

/** Host shown in the live link preview: configured app URL, else the page's own host, else the brand host. */
export function previewHost(appUrl: string | undefined, locationHost?: string): string {
  if (appUrl) {
    try {
      return new URL(appUrl).host;
    } catch {
      // fall through to the next source
    }
  }
  return locationHost || 'maw3ed.app';
}
