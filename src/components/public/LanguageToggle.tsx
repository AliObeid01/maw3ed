'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { cn } from '@/lib/cn';

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Switches between English and Arabic by writing the `locale` cookie and refreshing the server tree. */
export function LanguageToggle({ className }: { className?: string }) {
  const t = useTranslations('common.language');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next = locale === 'ar' ? 'en' : 'ar';

  return (
    <button
      type="button"
      lang={next}
      disabled={pending}
      onClick={() => {
        const secure = window.location.protocol === 'https:' ? '; secure' : '';
        document.cookie = `locale=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax${secure}`;
        startTransition(() => router.refresh());
      }}
      className={cn(
        'inline-flex h-11 items-center justify-center rounded-pill border border-line bg-surface px-4 text-[15px] text-ink transition-colors duration-200 ease-out hover:bg-canvas disabled:opacity-60',
        className,
      )}
    >
      {t('name')}
    </button>
  );
}
