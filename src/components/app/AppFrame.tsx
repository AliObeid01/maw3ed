'use client';

import { LogOut } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { ToastProvider } from '@/components/ui/Toast';
import { greetingFor } from '@/lib/dashboard/agenda';
import { AppShell } from './AppShell';
import { HEADER_SLOT_ID } from './HeaderActions';
import { VerifyBanner } from './VerifyBanner';
import { SessionProvider, type AppSession } from './SessionContext';
import { SummaryProvider, useSummary } from './SummaryContext';
import { defaultHrefs, type ActiveId } from './nav';
import { useSignOut } from './useSignOut';

/** Which nav entry is active for a pathname (longest matching href wins; unknown pages fall back to Today). */
export function activeIdFor(pathname: string): ActiveId {
  const entries = (Object.entries(defaultHrefs) as [ActiveId, string][])
    .filter(([id]) => id !== 'today')
    .sort((a, b) => b[1].length - a[1].length);
  const hit = entries.find(([, href]) => pathname === href || pathname.startsWith(`${href}/`));
  return hit ? hit[0] : 'today';
}

function AccountButton({ session }: { session: AppSession }) {
  const t = useTranslations('app.frame');
  const [open, setOpen] = useState(false);
  const { signOut, signingOut } = useSignOut();
  return (
    <>
      <button
        type="button"
        aria-label={t('account')}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="hidden size-11 shrink-0 items-center justify-center rounded-pill bg-brand-avatar text-base font-semibold text-brand transition-colors duration-200 ease-out hover:brightness-95 lg:flex"
      >
        {session.userName.trim().charAt(0).toUpperCase()}
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={t('account')} closeLabel={t('close')}>
        <div className="flex flex-col gap-1 pb-4">
          <span className="text-base font-semibold">{session.userName}</span>
          <span className="text-sm text-muted">
            {t('subtitle', { name: session.businessName, role: t(`role.${session.role}`) })}
          </span>
        </div>
        <Button variant="secondary" size="lg" block loading={signingOut} onClick={signOut}>
          <LogOut size={18} aria-hidden="true" className="rtl:-scale-x-100" />
          {t('signOut')}
        </Button>
      </Sheet>
    </>
  );
}

function Frame({ session, children }: { session: AppSession; children: ReactNode }) {
  const pathname = usePathname();
  const t = useTranslations('app');
  const tn = useTranslations('app.nav');
  const format = useFormatter();
  const activeId = activeIdFor(pathname);
  const { signOut, signingOut } = useSignOut();
  const { summary } = useSummary();
  const badges = { reminders: summary?.whatsappDue ?? 0, outcomes: summary?.outcomesToMark ?? 0 };
  // Detail pages keep their parent's nav item but carry their own title (board 4.5, 4.7).
  const isAppointment = pathname.startsWith('/app/appointments/');
  const isClient = pathname.startsWith('/app/clients/');
  const isToday = activeId === 'today' && !isAppointment;
  const announcement = summary
    ? [
        tn('badge.reminders', { count: badges.reminders }),
        tn('badge.outcomes', { count: badges.outcomes }),
      ].join('. ')
    : '';
  return (
    <>
      <AppShell
      business={{
        name: session.businessName,
        subtitle: t('frame.subtitle', {
          name: session.userName,
          role: t(`frame.role.${session.role}`),
        }),
      }}
      activeId={activeId}
      badges={badges}
      eyebrow={
        isToday
          ? format.dateTime(new Date(), {
              timeZone: session.timezone,
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              numberingSystem: 'latn',
            })
          : undefined
      }
      title={
        isToday
          ? t('today.greeting', { name: session.userName, part: greetingFor(session.timezone) })
          : isAppointment
            ? t('titles.appointment')
            : isClient
              ? t('titles.client')
              : t(`titles.${activeId}`)
      }
      hideBusiness={session.role !== 'OWNER'}
      onSignOut={signOut}
      signingOut={signingOut}
      actions={
        <>
          <div id={HEADER_SLOT_ID} className="contents" />
          <AccountButton session={session} />
        </>
      }
    >
      <VerifyBanner />
      {children}
      </AppShell>
      {/* Polite announcement when the badge counts change (the visible digits are hidden from AT). */}
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </>
  );
}

/** Client frame for the protected dashboard: shell, toasts and the session context. */
export function AppFrame({ session, children }: { session: AppSession; children: ReactNode }) {
  return (
    <SessionProvider value={session}>
      <ToastProvider>
        <SummaryProvider>
          <Frame session={session}>{children}</Frame>
        </SummaryProvider>
      </ToastProvider>
    </SessionProvider>
  );
}
