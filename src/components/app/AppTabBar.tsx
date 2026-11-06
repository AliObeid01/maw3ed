'use client';

import { Ellipsis } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CountBadge } from '@/components/ui/CountBadge';
import { cn } from '@/lib/cn';
import {
  badgeTone,
  moreNav,
  navIcons,
  practitionerNav,
  tabNav,
  type ActiveId,
  type NavBadges,
} from './nav';

type Props = {
  activeId: ActiveId;
  badges?: NavBadges;
  hrefs: Record<ActiveId, string>;
  moreOpen: boolean;
  onMore: () => void;
  /** The barber tab bar: Today, Mark outcome, Account. No More tab. */
  practitioner?: boolean;
};

const itemClass =
  'relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs no-underline transition-colors duration-200 ease-out';

function IconPill({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'relative flex h-7 w-12 items-center justify-center rounded-pill transition-colors duration-200 ease-out',
        active && 'bg-brand-soft',
      )}
    >
      {children}
    </span>
  );
}

/** Below `lg`: Today, Reminders (red badge), Outcomes (amber badge), Clients, More. Safe-area aware. */
export function AppTabBar({ activeId, badges, hrefs, moreOpen, onMore, practitioner }: Props) {
  const t = useTranslations('app.tabs');
  const tn = useTranslations('app.nav');
  const moreActive = (moreNav as string[]).includes(activeId);

  return (
    <nav
      aria-label={t('label')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-divider bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <div className="mx-auto flex max-w-xl items-stretch">
        {(practitioner ? practitionerNav : tabNav).map((id) => {
          const Icon = navIcons[id];
          const active = activeId === id;
          const count = id === 'reminders' || id === 'outcomes' ? (badges?.[id] ?? 0) : 0;
          return (
            <Link
              key={id}
              href={hrefs[id]}
              aria-current={active ? 'page' : undefined}
              className={cn(
                itemClass,
                active ? 'font-semibold text-brand' : 'font-medium text-muted',
              )}
            >
              <IconPill active={active}>
                <Icon size={22} aria-hidden="true" />
                {id === 'reminders' || id === 'outcomes' ? (
                  <CountBadge
                    count={count}
                    tone={badgeTone[id]}
                    label={tn(`badge.${id}`, { count })}
                    className="absolute -top-1 -end-0.5 h-[18px] min-w-[18px] px-1 text-[11px] ring-2 ring-surface"
                  />
                ) : null}
              </IconPill>
              <span>{t(id)}</span>
            </Link>
          );
        })}
        {practitioner ? null : (
        <button
          type="button"
          onClick={onMore}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={cn(
            itemClass,
            moreActive || moreOpen ? 'font-semibold text-brand' : 'font-medium text-muted',
          )}
        >
          <IconPill active={moreActive && !moreOpen}>
            <Ellipsis size={22} aria-hidden="true" />
          </IconPill>
          <span>{t('more')}</span>
        </button>
        )}
      </div>
    </nav>
  );
}
