'use client';

import Link, { useLinkStatus } from 'next/link';
import { useEffect, useRef, useSyncExternalStore, type ComponentProps } from 'react';
import { beginNavigation, navigationPending, subscribeNavigation } from '@/lib/navPending';

/** Inside a `<Link>`: reports the navigation to the progress bar and marks the link `aria-busy` while it is pending. */
function PendingMark() {
  const { pending } = useLinkStatus();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!pending) return;
    const link = ref.current?.closest('a');
    link?.setAttribute('aria-busy', 'true');
    const end = beginNavigation();
    return () => {
      link?.removeAttribute('aria-busy');
      end();
    };
  }, [pending]);
  return <span ref={ref} hidden />;
}

/**
 * A `next/link` that gives feedback while the page is loading: a subtle fade of the link (`aria-busy`, styled by the
 * caller or by the default `aria-busy:opacity-60`) and the slim progress bar at the top of the page.
 */
export function PendingLink({ children, className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link {...props} className={className}>
      {children}
      <PendingMark />
    </Link>
  );
}

/** Report a navigation that is not a link (the hero search `router.push`) to the progress bar while `pending`. */
export function useNavigationFlag(pending: boolean) {
  useEffect(() => {
    if (!pending) return;
    return beginNavigation();
  }, [pending]);
}

/** True while any navigation is in flight (the bar reads this). */
export function useNavigationPending(): boolean {
  return useSyncExternalStore(subscribeNavigation, navigationPending, () => false);
}
