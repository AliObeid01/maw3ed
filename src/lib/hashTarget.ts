/**
 * The element id a URL hash points at, or null. The hash comes from the address bar, so it can be anything:
 * `decodeURIComponent` throws on a malformed escape (`#%E0%A4%A`), which must never reach an error boundary.
 */
export function hashTargetId(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  try {
    return decodeURIComponent(raw) || null;
  } catch {
    return null;
  }
}
