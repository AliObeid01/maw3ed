'use client';

import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { NavLink } from './AppSidebar';
import { businessNav, type ActiveId, type NavBadges } from './nav';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeId: ActiveId;
  badges?: NavBadges;
  hrefs: Record<ActiveId, string>;
  onSignOut?: () => void;
  signingOut?: boolean;
};

/** Pilot report, the Business section and sign out. */
export function MoreSheet({
  open,
  onOpenChange,
  activeId,
  badges,
  hrefs,
  onSignOut,
  signingOut,
}: Props) {
  const t = useTranslations('app.more');
  const businessLabel = useTranslations('app.nav')('business');
  const close = () => onOpenChange(false);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('title')} closeLabel={t('close')}>
      <nav aria-label={t('title')} className="flex flex-col gap-0.5">
        <NavLink
          id="pilot"
          active={activeId === 'pilot'}
          href={hrefs.pilot}
          badges={badges}
          onNavigate={close}
        />
        <span className="mx-3 mt-3.5 mb-1.5 text-xs font-semibold tracking-[0.08em] text-subtle uppercase">
          {businessLabel}
        </span>
        {businessNav.map((id) => (
          <NavLink key={id} id={id} active={activeId === id} href={hrefs[id]} onNavigate={close} />
        ))}
      </nav>
      {onSignOut ? (
        <Button
          variant="secondary"
          size="lg"
          block
          loading={signingOut}
          onClick={onSignOut}
          className="mt-5"
        >
          <LogOut size={18} aria-hidden="true" className="rtl:-scale-x-100" />
          {t('signOut')}
        </Button>
      ) : null}
    </Sheet>
  );
}
