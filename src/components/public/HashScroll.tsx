'use client';

import { useEffect } from 'react';

/**
 * Cross-page anchors (`/how-it-works#reminders` from the footer): Next scrolls to the hash as soon as the new route
 * renders, and while the route's `loading.tsx` skeleton is on screen the target does not exist yet, so the scroll
 * finds nothing and the old scroll position is kept. This runs once the real content is mounted and scrolls to the
 * target then (the sticky header is cleared by `scroll-padding-top` and `scroll-mt-4`). Renders nothing.
 */
export function HashScroll() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, []);
  return null;
}
