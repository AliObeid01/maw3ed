import type { SlugCheck } from '@/lib/api/auth';
import { isReservedSlug, isValidSlugFormat } from './slug';

export type SlugStatus =
  'idle' | 'checking' | 'available' | 'invalid' | 'reserved' | 'taken' | 'unknown';

export const SLUG_DEBOUNCE_MS = 400;

/** Status shown for `slug` given the last network result. Local problems never wait for the network. */
export function deriveSlugStatus(
  slug: string,
  result: { slug: string; status: SlugStatus } | null,
): SlugStatus {
  if (!slug) return 'idle';
  if (!isValidSlugFormat(slug)) return 'invalid';
  if (isReservedSlug(slug)) return 'reserved';
  // A result for an older slug is stale: show "checking" until the new one lands.
  return result && result.slug === slug ? result.status : 'checking';
}

/** True when the slug needs a server check. */
export const needsServerCheck = (slug: string) => isValidSlugFormat(slug) && !isReservedSlug(slug);

/**
 * Debounced availability check. Returns a cancel function that clears the timer and aborts the
 * request; a response (or failure) after cancel is ignored, so a stale slug never overwrites a newer one.
 * A failed check reports `unknown` (the server re-checks on submit).
 */
export function scheduleSlugCheck(
  slug: string,
  check: (slug: string, signal: AbortSignal) => Promise<SlugCheck>,
  onResult: (slug: string, status: SlugStatus) => void,
  debounceMs = SLUG_DEBOUNCE_MS,
): () => void {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    check(slug, controller.signal)
      .then((r) => {
        if (!controller.signal.aborted)
          onResult(slug, r.available ? 'available' : (r.reason ?? 'taken'));
      })
      .catch(() => {
        if (!controller.signal.aborted) onResult(slug, 'unknown');
      });
  }, debounceMs);
  return () => {
    clearTimeout(timer);
    controller.abort();
  };
}
