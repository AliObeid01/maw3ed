'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * 56 px floating "New booking" above the tab bar, on the end side. Hidden at `lg` (the sidebar has the button).
 * It steps out of the way while the page scrolls down or a field has focus, so it never sits on a form's
 * chips, units or Save button; it comes back on scroll up and at the top of the page.
 */
export function NewBookingFab({
  href,
  active,
  className,
}: {
  href: string;
  active?: boolean;
  className?: string;
}) {
  const t = useTranslations('app.nav');
  const [away, setAway] = useState(false);

  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y < 48 || y < last - 4) setAway(false);
      else if (y > last + 4) setAway(true);
      last = y;
    };
    const isField = (el: EventTarget | null) =>
      el instanceof HTMLElement && el.matches('input, textarea, select, [contenteditable="true"]');
    const onFocusIn = (e: FocusEvent) => {
      if (isField(e.target)) setAway(true);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (isField(e.target)) setAway(false);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  // On the booking screen itself the sticky Book button owns the thumb zone; the FAB would sit on top of it.
  if (active) return null;
  return (
    <Link
      href={href}
      aria-label={t('newBooking')}
      aria-current={active ? 'page' : undefined}
      tabIndex={away ? -1 : undefined}
      aria-hidden={away ? true : undefined}
      className={cn(
        'fixed end-4 bottom-[calc(64px+env(safe-area-inset-bottom)+16px)] z-30 flex size-14 items-center justify-center rounded-pill bg-brand text-white shadow-[0_1px_3px_rgb(0_0_0/0.06),0_6px_16px_rgb(23_76_79/0.25)] transition-[colors,transform,opacity] duration-200 ease-out hover:bg-brand-hover motion-reduce:transition-none lg:hidden',
        away && 'pointer-events-none translate-y-24 opacity-0',
        className,
      )}
    >
      <Plus size={26} strokeWidth={2.5} aria-hidden="true" />
    </Link>
  );
}
