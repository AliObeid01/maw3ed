'use client';

import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LanguageToggle } from '@/components/public/LanguageToggle';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { BusinessSection, NavLink } from './AppSidebar';
import type { ActiveId, NavBadges } from './nav';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeId: ActiveId;
  badges?: NavBadges;
  hrefs: Record<ActiveId, string>;
  onSignOut?: () => void;
  signingOut?: boolean;
  hideBusiness?: boolean;
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
  hideBusiness,
}: Props) {
  const t = useTranslations('app.more');
  const close = () => onOpenChange(false);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('title')} closeLabel={t('close')}>
      <nav aria-label={t('title')}>
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          <NavLink
            id="pilot"
            active={activeId === 'pilot'}
            href={hrefs.pilot}
            badges={badges}
            onNavigate={close}
          />
        </ul>
        {hideBusiness ? null : (
          <BusinessSection activeId={activeId} hrefs={hrefs} onNavigate={close} />
        )}
      </nav>
      <LanguageToggle className="mt-5 w-full" />
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
