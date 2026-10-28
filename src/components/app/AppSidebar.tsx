'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Logo } from '@/components/brand/Logo';
import { monogram } from '@/components/public/BusinessHero';
import { ButtonLink } from '@/components/ui/Button';
import { CountBadge } from '@/components/ui/CountBadge';
import { cn } from '@/lib/cn';
import {
  badgeTone,
  businessNav,
  mainNav,
  navIcons,
  type ActiveId,
  type NavBadges,
  type NavId,
} from './nav';

export type ShellBusiness = { name: string; subtitle: string };

type Props = {
  business: ShellBusiness;
  activeId: ActiveId;
  badges?: NavBadges;
  hrefs: Record<ActiveId, string>;
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
  );
}

/** Board 21: 256 px sidebar for `lg+`. */
export function AppSidebar({ business, activeId, badges, hrefs, className }: Props) {
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
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-nav bg-accent text-sm font-bold text-ink"
        >
          {monogram(business.name)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-semibold">{business.name}</span>
          <span className="truncate text-xs text-muted">{business.subtitle}</span>
        </span>
      </div>

      <nav aria-label={t('main')} className="flex flex-col gap-0.5">
        {mainNav.map((id) => (
          <NavLink key={id} id={id} active={activeId === id} href={hrefs[id]} badges={badges} />
        ))}
        <span className="mx-3 mt-3.5 mb-1.5 text-xs font-semibold tracking-[0.08em] text-subtle uppercase">
          {t('business')}
        </span>
        {businessNav.map((id) => (
          <NavLink key={id} id={id} active={activeId === id} href={hrefs[id]} />
        ))}
      </nav>

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
    </aside>
  );
}
