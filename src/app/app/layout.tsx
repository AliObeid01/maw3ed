import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppFrame } from '@/components/app/AppFrame';
import { ForbiddenView } from '@/components/app/ForbiddenView';
import { PATH_HEADER } from '@/i18n/config';
import { practitionerGate } from '@/lib/auth/practitionerPaths';
import { ScopedIntl } from '@/components/i18n/ScopedIntl';
import { loadSession } from './loadSession';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Protected dashboard: every page under /app needs a session; the shell shows the real business and user. */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await loadSession();
  // Default-deny for the barber login. This is the second line: every server page also calls
  // assertPractitionerPath() because a client-side soft navigation does not re-run this layout. It FAILS CLOSED:
  // without the path header a barber gets the forbidden state, never the children (and never a redirect, which
  // would loop on an allowed page).
  const gate = practitionerGate(session.role, (await headers()).get(PATH_HEADER));
  if (gate.kind === 'redirect') redirect(gate.to);
  if (gate.kind === 'forbidden') return <ForbiddenView />;
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
          logoUrl: session.logoUrl,
          timezone: session.timezone,
        }}
      >
        {children}
      </AppFrame>
    </ScopedIntl>
  );
}
