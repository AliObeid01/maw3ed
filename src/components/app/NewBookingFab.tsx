'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

const NON_TEXT_INPUTS = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'range',
  'file',
  'color',
  'image',
]);

/** True for fields that open the on-screen keyboard. */
function isTextEntry(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(el.type);
  return el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el.isContentEditable;
}

/**
 * 56 px floating "New booking" above the tab bar, on the end side. Hidden at `lg` (the sidebar has the button).
 * It is always in the tab order and the accessibility tree. The page keeps bottom padding so it never covers
 * the last row. Only while a text-entry field has focus (the on-screen keyboard covers it) it is faded out with
 * CSS, and it is back on blur or as soon as it receives keyboard focus.
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
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => setTyping(isTextEntry(e.target));
    const onFocusOut = () => setTyping(false);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
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
      data-testid="new-booking-fab"
      data-hidden={typing || undefined}
      className={cn(
        'fixed end-4 bottom-[calc(64px+env(safe-area-inset-bottom)+16px)] z-30 flex size-14 items-center justify-center rounded-card bg-brand text-white shadow-[0_1px_2px_rgb(0_0_0/0.08),0_3px_8px_rgb(0_0_0/0.08)] transition-[background-color,transform,opacity] duration-200 ease-out hover:bg-brand-hover motion-reduce:transition-none lg:hidden',
        typing &&
          'pointer-events-none translate-y-24 opacity-0 focus-visible:pointer-events-auto focus-visible:translate-y-0 focus-visible:opacity-100',
        className,
      )}
    >
      <Plus size={26} strokeWidth={2.5} aria-hidden="true" />
    </Link>
  );
}
