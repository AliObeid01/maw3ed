import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppFrame } from '@/components/app/AppFrame';
import { PATH_HEADER } from '@/i18n/config';
import { practitionerMayView } from '@/lib/auth/practitionerPaths';
import { ScopedIntl } from '@/components/i18n/ScopedIntl';
import { loadSession } from './loadSession';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Protected dashboard: every page under /app needs a session; the shell shows the real business and user. */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await loadSession();
  // Default-deny for the barber login: only the welcome and account pages exist for it until the scoped screens land.
  if (session.role === 'PRACTITIONER') {
    const path = (await headers()).get(PATH_HEADER);
    if (path && !practitionerMayView(path)) redirect('/app/welcome');
  }
  return (
    // The business zone is the formatting fallback for every client component in the dashboard (F5).
    <ScopedIntl scope="app" timeZone={session.timezone}>
      <AppFrame
        session={{
          userName: session.userName,
          email: session.email,
          phone: session.phone,
          emailVerified: session.emailVerified,
          role: session.role,
          businessName: session.businessName,
          slug: session.businessSlug,
          timezone: session.timezone,
        }}
      >
        {children}
      </AppFrame>
    </ScopedIntl>
  );
}
