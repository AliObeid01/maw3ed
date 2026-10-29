/**
 * Server clock offset in milliseconds: `serverNow = Date.now() + offset`. Taken from the `Date` header of the
 * offer response, so a phone with a wrong clock still counts down to the server's expiry. A missing or invalid
 * header gives 0 (trust the device). The header has one-second resolution, which is fine for a 30 minute offer.
 */
export function serverOffsetMs(dateHeader: string | null | undefined, localNowMs: number): number {
  if (!dateHeader) return 0;
  const server = Date.parse(dateHeader);
  return Number.isFinite(server) ? server - localNowMs : 0;
}

/** The server's idea of "now" given the recorded offset. */
export const serverNow = (offsetMs: number, localNowMs: number = Date.now()) => localNowMs + offsetMs;

/**
 * Only same-origin paths and https URLs may become a link href (the manage link comes from an API response).
 * Anything else (javascript:, data:, protocol-relative, http to another host) returns undefined.
 */
export function safeHref(href: string, origin: string = typeof location === 'undefined' ? '' : location.origin): string | undefined {
  if (href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/\\')) return href;
  try {
    const url = new URL(href);
    if (url.protocol === 'https:') return href;
    if (origin && url.origin === origin) return href;
  } catch {
    // not a URL
  }
  return undefined;
}
