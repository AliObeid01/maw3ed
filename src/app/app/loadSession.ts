import { cookies } from 'next/headers';
import { requireSession, type CurrentSession } from '@/server/http/session';

/**
 * The dashboard's session. In production this is always `requireSession()` (redirects to /login).
 *
 * Browser tests and design screenshots run `next dev` with E2E_FAKE_SESSION=1 and mock every API call in the
 * page, so there is no database to hold a real session. That switch is ignored whenever NODE_ENV is
 * "production" (that is, in `next build` / `next start` and on Vercel), and `e2e_role` picks OWNER or STAFF.
 */
export async function loadSession(): Promise<CurrentSession> {
  if (process.env.E2E_FAKE_SESSION === '1' && process.env.NODE_ENV !== 'production') {
    const role = (await cookies()).get('e2e_role')?.value === 'STAFF' ? 'STAFF' : 'OWNER';
    return {
      userId: 'e2e-user',
      userName: 'Lina',
      businessId: 'e2e-business',
      businessName: 'Studio Nour',
      businessSlug: 'studio-nour',
      timezone: 'Asia/Beirut',
      role,
    };
  }
  return requireSession();
}
