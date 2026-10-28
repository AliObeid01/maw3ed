import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AuthBackdrop } from '@/components/auth/AuthBackdrop';
import { Logo } from '@/components/brand/Logo';
import { LanguageToggle } from '@/components/public/LanguageToggle';

/** Shared frame for sign up, sign in and accept invite: backdrop, logo, then the page's card and footer. */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('auth');
  return (
    <div className="group/auth relative isolate flex min-h-dvh flex-col items-center overflow-x-clip px-4 pt-20 pb-10 md:justify-center md:px-5 md:py-12">
      <AuthBackdrop />
      <div className="absolute end-4 top-4">
        <LanguageToggle />
      </div>
      <main className="flex w-full flex-col items-center gap-6 md:gap-7">
        <Link href="/" aria-label={t('home')} className="flex min-h-11 items-center rounded-pill">
          <Logo width={160} />
        </Link>
        {children}
      </main>
    </div>
  );
}
