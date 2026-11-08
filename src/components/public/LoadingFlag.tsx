'use client';

import { useNavigationFlag } from './PendingLink';

/**
 * Rendered inside a route skeleton (`PageLoading`): while the skeleton is on screen the page is still loading, so the
 * top progress bar stays up until the real page replaces it. (A link's own pending state ends as soon as Next has
 * committed the prefetched skeleton, which would otherwise take the bar away while the page is still arriving.)
 */
export function LoadingFlag() {
  useNavigationFlag(true);
  return null;
}
