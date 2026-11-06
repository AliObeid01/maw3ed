'use client';

import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import type { AppSession } from './SessionContext';
import { useSignOut } from './useSignOut';

const HOME = '/app/welcome';
const ACCOUNT = '/app/account';

/**
 * The only dashboard a PRACTITIONER (barber with a phone login) gets in PR-4: a header, the welcome page and the
 * account page. No business navigation and no data requests (every other route refuses this role).
 */
export function PractitionerFrame({
  session,
  children,
}: {
  session: AppSession;
  children: ReactNode;
}) {
  const t = useTranslations('app.practitioner');
  const tf = useTranslations('app.frame');
  const pathname = usePathname();
  const { signOut, signingOut } = useSignOut();
  const subtitle = tf('subtitle', { name: session.userName, role: tf(`role.${session.role}`) });
  const signOutLabel = tf('signOut');
  const link = (href: string, label: string) => (
    <Link
      key={href}
      href={href}
      aria-current={pathname === href ? 'page' : undefined}
      className={cn(
        'flex min-h-11 items-center rounded-nav px-3 text-[15px] no-underline',
        pathname === href ? 'bg-brand-soft font-semibold text-brand' : 'text-ink',
      )}
    >
      {label}
    </Link>
  );
  const links = [link(HOME, t('welcomeLink')), link(ACCOUNT, t('accountLink'))];
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="flex flex-wrap items-center gap-2 border-b border-divider bg-surface px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-semibold">{session.businessName}</span>
          <span className="truncate text-sm text-muted">{subtitle}</span>
        </div>
        <nav aria-label={t('nav')} className="flex items-center gap-1">
          {links}
        </nav>
        <Button variant="secondary" size="md" loading={signingOut} onClick={signOut}>
          <LogOut size={18} aria-hidden="true" className="rtl:-scale-x-100" />
          {signOutLabel}
        </Button>
      </header>
      <main className="mx-auto w-full max-w-xl p-4 md:p-8">{children}</main>
    </div>
  );
}
