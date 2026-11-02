import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { authService } from '@/server/services/auth';
import type { RoleName } from './auth';
import { sessionCookieName } from './cookies';

export interface CurrentSession {
  userId: string;
  userName: string;
  /** The signed-in address, shown on the Account page. */
  email: string;
  /** Soft verification: false shows the dashboard banner and disables inviting and listing. */
  emailVerified: boolean;
  businessId: string;
  businessName: string;
  businessSlug: string;
  timezone: string;
  role: RoleName;
}

/**
 * For server components and layouts: the signed-in user's session, or null. Reads the cookie through
 * next/headers. (Server components cannot set cookies, so the cookie's browser expiry is re-issued by
 * the next API call that slides the session; the database expiry is extended here regardless.)
 */
export async function getCurrentSession(): Promise<CurrentSession | null> {
  const token = (await cookies()).get(sessionCookieName())?.value;
  return token ? authService.current(token) : null;
}

/** Like getCurrentSession but redirects to /login when there is no valid session. */
export async function requireSession(): Promise<CurrentSession> {
  const session = await getCurrentSession();
  if (!session) redirect('/login');
  return session;
}
