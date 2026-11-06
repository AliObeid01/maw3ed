import type { Metadata } from 'next';
import { AppFrame } from '@/components/app/AppFrame';
import { ScopedIntl } from '@/components/i18n/ScopedIntl';
import { loadSession } from './loadSession';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Protected dashboard: every page under /app needs a session; the shell shows the real business and user. */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await loadSession();
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
