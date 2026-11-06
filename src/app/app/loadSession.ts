import { cookies } from 'next/headers';
import { cache } from 'react';
import { requireSession, type CurrentSession } from '@/server/http/session';

/**
 * The dashboard's session. In production this is always `requireSession()` (redirects to /login).
 *
 * TEST-ONLY SWITCH. Browser tests and design screenshots run `next dev` with E2E_FAKE_SESSION=1 and mock
 * every API call in the page, so there is no database to hold a real session. With the switch on, EVERY
 * visitor is signed in as a fake owner (or as STAFF with the `e2e_role` cookie). It must never be set on a
 * shared dev, staging or preview server, and the app refuses to render if it is set where NODE_ENV is
 * "production" or on Vercel, instead of silently ignoring it.
 */
/** `cache` shares one read between the layout and the page guard of the same request. */
export const loadSession = cache(async function loadSession(): Promise<CurrentSession> {
  if (process.env.E2E_FAKE_SESSION) {
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
      throw new Error(
        'E2E_FAKE_SESSION is set in a production or Vercel environment. Unset it: it signs everyone in.',
      );
    }
    if (process.env.E2E_FAKE_SESSION === '1') {
      const roleCookie = (await cookies()).get('e2e_role')?.value;
      const role =
        roleCookie === 'STAFF' ? 'STAFF' : roleCookie === 'PRACTITIONER' ? 'PRACTITIONER' : 'OWNER';
      return {
        userId: 'e2e-user',
        userName: 'Lina',
        email: 'lina@studio-nour.test',
        phone: role === 'PRACTITIONER' ? '+961 70 000 001' : null,
        // `e2e_unverified` cookie: show the unverified-email banner and disable inviting / listing.
        emailVerified: (await cookies()).get('e2e_unverified')?.value !== '1',
        businessId: 'e2e-business',
        businessName: 'Studio Nour',
        businessSlug: 'studio-nour',
        timezone: 'Asia/Beirut',
        role,
      };
    }
  }
  return requireSession();
});
