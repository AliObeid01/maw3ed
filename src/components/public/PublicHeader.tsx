'use client';

import { Menu } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Logo } from '@/components/brand/Logo';
import { ButtonLink } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Sheet } from '@/components/ui/Sheet';
import { cn } from '@/lib/cn';
import { LanguageToggle } from './LanguageToggle';

export type PublicHeaderProps = {
  homeHref?: string;
  forBusinessesHref?: string;
  pricingHref?: string;
  helpHref?: string;
  signInHref?: string;
  className?: string;
};

const linkClass =
  'flex min-h-11 items-center rounded-pill px-3.5 text-[15px] font-medium text-ink no-underline transition-colors duration-200 ease-out hover:bg-canvas';

/** Board 01. Logo + links + language toggle + sign in; logo + menu sheet on phones. */
export function PublicHeader({
  homeHref = '/',
  forBusinessesHref = '/signup',
  pricingHref = '/pricing',
  helpHref = '/help',
  signInHref = '/login',
  className,
}: PublicHeaderProps) {
  const t = useTranslations('public.header');
  const appName = useTranslations('common')('appName');
  const [open, setOpen] = useState(false);
  const links = [
    { href: forBusinessesHref, label: t('forBusinesses') },
    { href: pricingHref, label: t('pricing') },
    { href: helpHref, label: t('help') },
  ];

  return (
    <header className={cn('w-full border-b border-divider bg-surface', className)}>
      <div className="mx-auto flex max-w-[1240px] items-center gap-3 px-4 py-2 md:gap-7 md:px-8 md:py-3">
        <Link href={homeHref} aria-label={t('home')} className="flex min-h-11 items-center">
          <Logo width={132} className="max-md:w-[112px]" />
        </Link>

        <nav aria-label={t('navLabel')} className="hidden flex-1 gap-1 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={linkClass}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-2">
          <LanguageToggle />
          <ButtonLink href={signInHref} className="hidden md:inline-flex">
            {t('signIn')}
          </ButtonLink>
          <IconButton
            label={t('menu')}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className="md:hidden"
          >
            <Menu size={20} aria-hidden="true" />
          </IconButton>
        </div>
      </div>

      <Sheet open={open} onOpenChange={setOpen} title={appName} closeLabel={t('close')}>
        <nav aria-label={t('navLabel')} className="flex flex-col gap-1">
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className={linkClass}>
              {l.label}
            </Link>
          ))}
        </nav>
        <ButtonLink href={signInHref} size="lg" block className="mt-4">
          {t('signIn')}
        </ButtonLink>
      </Sheet>
    </header>
  );
}
