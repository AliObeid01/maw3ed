export type NavId = 'explore' | 'how' | 'owners' | 'my';
export type NavLink = { id: Exclude<NavId, 'owners'>; href: string; key: 'explore' | 'howItWorks' | 'myBookings' };

const EXPLORE: NavLink = { id: 'explore', href: '/', key: 'explore' };
const HOW: NavLink = { id: 'how', href: '/how-it-works', key: 'howItWorks' };
const MY: NavLink = { id: 'my', href: '/my-bookings', key: 'myBookings' };

/** Header links on wide screens. "My bookings" only exists on a device that has saved bookings. The owners button is separate. */
export const navLinks = (hasSaved: boolean): NavLink[] => (hasSaved ? [EXPLORE, MY, HOW] : [EXPLORE, HOW]);

/** Phone tab bar: 2 tabs, 3 with saved bookings. "For business owners" stays the header button on phones. */
export const tabItems = (hasSaved: boolean): NavLink[] => (hasSaved ? [EXPLORE, HOW, MY] : [EXPLORE, HOW]);

const MARKETPLACE = new Set([
  '/',
  '/directory',
  '/how-it-works',
  '/for-business',
  '/privacy',
  '/terms',
  '/my-bookings',
]);

/** The marketplace pages carry the phone tab bar and the skip link target; the booking flow (`/b`, `/l`, `/o`, `/pay`) does not. */
export const showTabBar = (pathname: string): boolean => MARKETPLACE.has(pathname);

/** Which nav item is the current page (legal and the booking flow have none). */
export function activeTab(pathname: string): NavId | null {
  if (pathname === '/' || pathname === '/directory') return 'explore';
  if (pathname === '/how-it-works') return 'how';
  if (pathname === '/for-business') return 'owners';
  if (pathname === '/my-bookings') return 'my';
  return null;
}
