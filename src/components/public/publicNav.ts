export type NavId = 'explore' | 'how' | 'pricing' | 'owners' | 'my';

const MARKETPLACE = new Set(['/', '/directory', '/pricing', '/privacy', '/terms', '/my-bookings']);

/** The marketplace pages carry the phone tab bar and the skip link target; the booking flow (`/b`, `/l`, `/o`, `/pay`) does not. */
export const showTabBar = (pathname: string): boolean => MARKETPLACE.has(pathname);

/** Which nav item is the current page. `#how` on the home page selects "How it works". */
export function activeTab(pathname: string, hash: string): NavId | null {
  if (pathname === '/') return hash === '#how' ? 'how' : 'explore';
  if (pathname === '/directory') return 'explore';
  if (pathname === '/pricing') return 'pricing';
  if (pathname === '/my-bookings') return 'my';
  return null;
}
