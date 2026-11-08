'use client';

import { Plus } from 'lucide-react';
import { useId } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Logo } from '@/components/brand/Logo';
import { LanguageToggle } from '@/components/public/LanguageToggle';
import { ButtonLink } from '@/components/ui/Button';
import { BusinessAvatar } from '@/components/ui/BusinessAvatar';
import { CountBadge } from '@/components/ui/CountBadge';
import { cn } from '@/lib/cn';
import {
  badgeTone,
  businessNav,
  mainNav,
  navIcons,
  practitionerMainNav,
  type ActiveId,
  type NavBadges,
  type NavId,
} from './nav';

export type ShellBusiness = { name: string; subtitle: string; logoUrl?: string | null };

type Props = {
  business: ShellBusiness;
  activeId: ActiveId;
  badges?: NavBadges;
  hrefs: Record<ActiveId, string>;
  hideBusiness?: boolean;
  /** The barber sidebar: Today and Mark outcome, Account. No business navigation and no New booking. */
  practitioner?: boolean;
  className?: string;
};

/** Shared nav row for the sidebar and the More sheet. min-height 44, radius 12. */
export function NavLink({
  id,
  active,
  href,
  badges,
  onNavigate,
}: {
  id: NavId;
  active: boolean;
  href: string;
  badges?: NavBadges;
  onNavigate?: () => void;
}) {
  const t = useTranslations('app.nav');
  const Icon = navIcons[id];
  const count = id === 'reminders' || id === 'outcomes' ? (badges?.[id] ?? 0) : 0;
  return (
    <li>
      <Link
        href={href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex min-h-11 items-center gap-3 rounded-nav px-3 text-[15px] no-underline transition-colors duration-200 ease-out',
          active
            ? 'bg-brand-soft font-semibold text-brand'
            : 'font-medium text-muted hover:bg-canvas hover:text-ink',
        )}
      >
        <Icon size={20} aria-hidden="true" />
        <span className="flex-1">{t(id)}</span>
        {id === 'reminders' || id === 'outcomes' ? (
          <CountBadge count={count} tone={badgeTone[id]} label={t(`badge.${id}`, { count })} />
        ) : null}
      </Link>
    </li>
  );
}

/** "Business" heading plus its list, labelled for assistive tech. Shared by the sidebar and the More sheet. */
export function BusinessSection({
  activeId,
  hrefs,
  onNavigate,
}: {
  activeId: ActiveId;
  hrefs: Record<ActiveId, string>;
  onNavigate?: () => void;
}) {
  const heading = useTranslations('app.nav')('business');
  const headingId = useId();
  return (
    <>
      <span
        id={headingId}
        className="mx-3 mt-3.5 mb-1.5 block text-xs font-semibold tracking-[0.08em] text-muted uppercase"
      >
        {heading}
      </span>
      <ul aria-labelledby={headingId} className="m-0 flex list-none flex-col gap-0.5 p-0">
        {businessNav.map((id) => (
          <NavLink
            key={id}
            id={id}
            active={activeId === id}
            href={hrefs[id]}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </>
  );
}

/** Board 21: 256 px sidebar for `lg+`. */
export function AppSidebar({
  business,
  activeId,
  badges,
  hrefs,
  hideBusiness,
  practitioner,
  className,
}: Props) {
  const t = useTranslations('app.nav');
  const appName = useTranslations('common')('appName');
  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-5 overflow-y-auto border-e border-divider bg-surface px-3.5 py-[22px] lg:flex',
        className,
      )}
    >
      <Link
        href={hrefs.today}
        aria-label={appName}
        className="ms-2 flex min-h-11 w-fit items-center rounded-nav"
      >
        <Logo width={130} />
      </Link>

      <div className="flex items-center gap-2.5 rounded-2xl bg-canvas p-2.5">
        <BusinessAvatar name={business.name} logoUrl={business.logoUrl} size={36} tone="cyan" priority />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-semibold">{business.name}</span>
          <span className="truncate text-xs text-muted">{business.subtitle}</span>
        </span>
      </div>

      <nav aria-label={t('main')}>
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {(practitioner ? practitionerMainNav : mainNav).map((id) => (
            <NavLink key={id} id={id} active={activeId === id} href={hrefs[id]} badges={badges} />
          ))}
        </ul>
        {hideBusiness ? null : <BusinessSection activeId={activeId} hrefs={hrefs} />}
      </nav>

      {practitioner ? null : (
        <ButtonLink
          href={hrefs.book}
          size="lg"
          block
          aria-current={activeId === 'book' ? 'page' : undefined}
          className="mt-3"
        >
          <Plus size={18} strokeWidth={2.5} aria-hidden="true" />
          {t('newBooking')}
        </ButtonLink>
      )}

      <div className="mt-auto flex flex-col gap-3">
        <nav aria-label={t('accountNav')}>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            <NavLink id="account" active={activeId === 'account'} href={hrefs.account} />
          </ul>
        </nav>
        <LanguageToggle className="w-full" />
      </div>
    </aside>
  );
}
