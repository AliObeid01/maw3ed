'use client';

import { CalendarCheck, Compass, Info, Store } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/brand/Logo';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { cn } from '@/lib/cn';
import { useSavedCount } from '@/components/myBookings/useSavedBookings';
import { LanguageToggle } from './LanguageToggle';
import { activeTab, showTabBar } from './publicNav';

export type PublicHeaderProps = {
  homeHref?: string;
  className?: string;
};

const TABS = [
  { id: 'explore', href: '/directory', key: 'explore', Icon: Compass },
  { id: 'how', href: '/#how', key: 'howItWorks', Icon: Info },
  { id: 'owners', href: '/signup', key: 'forBusinesses', Icon: Store },
] as const;

const linkClass =
  'relative flex min-h-11 items-center rounded-nav px-4 text-[15px] font-medium text-muted no-underline transition-colors duration-200 ease-out hover:text-ink after:absolute after:inset-x-4 after:bottom-1 after:h-[3px] after:rounded-[3px] after:bg-brand after:transition-transform after:duration-200 after:ease-out after:content-[""] hover:after:scale-x-100 aria-[current=page]:font-semibold aria-[current=page]:text-ink motion-reduce:transition-none';

/** The hash of the current URL (`#how` while the visitor is on that section); empty on the server. */
function useHash(): [string, (hash: string) => void] {
  const [hash, setHash] = useState('');
  useEffect(() => {
    const read = () => setHash(window.location.hash);
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  return [hash, setHash];
}

/**
 * The marketplace header (owner design, home page). Wide: logo, Explore / How it works / Pricing, language toggle,
 * a small Sign in link (owners and staff) and the navy "For business owners" button. Phone: logo, language toggle and
 * the owners button, with a fixed bottom tab bar on the marketplace pages (`/`, `/directory`, `/pricing`).
 */
export function PublicHeader({ homeHref = '/', className }: PublicHeaderProps) {
  const t = useTranslations('public.header');
  const pathname = usePathname() ?? '/';
  const [hash, setHash] = useHash();
  const current = activeTab(pathname, hash);
  const tabs = showTabBar(pathname);

  // "My bookings" only shows on a device that has saved bookings (read after mount: the server renders without it).
  const hasSaved = useSavedCount() > 0;
  const links = [
    { id: 'explore', href: '/directory', label: t('explore') },
    { id: 'how', href: '/#how', label: t('howItWorks') },
    { id: 'pricing', href: '/pricing', label: t('pricing') },
    ...(hasSaved ? [{ id: 'my', href: '/my-bookings', label: t('myBookings') }] : []),
  ] as const;
  const tabItems = hasSaved
    ? [...TABS, { id: 'my', href: '/my-bookings', key: 'myBookings', Icon: CalendarCheck } as const]
    : TABS;

  return (
    <>
      {tabs ? (
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:flex focus:min-h-11 focus:items-center focus:rounded-btn focus:bg-navy focus:px-4 focus:text-white"
      >
        {t('skip')}
      </a>
      ) : null}
      <header
        className={cn('sticky top-0 z-30 w-full border-b border-divider bg-surface', className)}
      >
        <div className="mx-auto flex min-h-16 max-w-[1200px] items-center gap-2 px-4 md:min-h-[68px] md:gap-4 md:px-6">
          <Link href={homeHref} className="me-auto flex min-h-11 items-center lg:me-0">
            <Logo label={t('home')} width={132} className="max-md:h-auto max-md:w-[104px]" />
          </Link>

          <nav aria-label={t('navLabel')} className="me-auto ms-4 hidden gap-1 lg:flex">
            {links.map((l) => (
              <Link
                key={l.id}
                href={l.href}
                onClick={() => setHash(l.id === 'how' ? '#how' : '')}
                aria-current={current === l.id ? 'page' : undefined}
                className={cn(linkClass, current === l.id ? 'after:scale-x-100' : 'after:scale-x-0')}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          <LanguageToggle className="max-md:px-3" />
          <Link
            href="/login"
            className="hidden min-h-11 items-center px-3 text-[15px] font-medium text-muted no-underline hover:text-ink lg:inline-flex"
          >
            {t('signIn')}
          </Link>
          <Link
            href="/signup"
            className={buttonClasses({
              variant: 'navy',
              size: 'hero',
              className: 'h-11 px-3.5 text-[14px] md:px-[18px] md:text-[15px]',
            })}
          >
            <span className="sm:hidden">{t('forBusinessesShort')}</span>
            <span className="hidden sm:inline">{t('forBusinesses')}</span>
          </Link>
        </div>
      </header>

      {tabs ? (
        <nav
          aria-label={t('tabsLabel')}
          className="public-tabbar fixed inset-x-0 bottom-0 z-40 grid grid-flow-col auto-cols-fr border-t border-divider bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          {tabItems.map(({ id, href, key, Icon }) => (
            <Link
              key={id}
              href={href}
              onClick={() => setHash(id === 'how' ? '#how' : '')}
              aria-current={current === id ? 'page' : undefined}
              className="relative flex min-h-[62px] flex-col items-center justify-center gap-1 px-1 text-center text-xs font-medium text-muted no-underline aria-[current=page]:font-bold aria-[current=page]:text-brand aria-[current=page]:before:absolute aria-[current=page]:before:top-0 aria-[current=page]:before:h-[3px] aria-[current=page]:before:w-9 aria-[current=page]:before:rounded-b-[3px] aria-[current=page]:before:bg-brand aria-[current=page]:before:content-['']"
            >
              <Icon size={22} aria-hidden="true" />
              <span className="leading-tight">{t(key)}</span>
            </Link>
          ))}
        </nav>
      ) : null}
    </>
  );
}
