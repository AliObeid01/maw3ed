'use client';

import { useNavigationPending } from './PendingLink';

/**
 * A slim bar at the very top of the page while a client navigation is loading (pure CSS, see `.nav-progress` in
 * globals.css). It starts after a short delay so instant navigations show nothing, creeps toward the end and is
 * removed when the new page is in. Decorative: the link itself carries `aria-busy`. With reduced motion it is a
 * static bar, no animation.
 */
export function NavProgress() {
  const pending = useNavigationPending();
  if (!pending) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="nav-progress"
      className="nav-progress pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] bg-turquoise ltr:origin-left rtl:origin-right"
    />
  );
}
