import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Logo } from '@/components/brand/Logo';
import { ScopedIntl } from '@/components/i18n/ScopedIntl';
import { LanguageToggle } from '@/components/public/LanguageToggle';

/** Shared frame for sign up, sign in and accept invite: logo, then the page's card and footer. */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('auth');
  return (
    <ScopedIntl scope="auth">
      <div className="group/auth relative isolate flex min-h-dvh flex-col items-center overflow-x-clip px-4 pt-[72px] pb-8 md:justify-center md:px-5 md:py-8">
        <div className="absolute end-4 top-4">
          <LanguageToggle />
        </div>
        <main className="flex w-full flex-col items-center gap-5">
          <Link href="/" className="flex min-h-11 items-center rounded-btn">
            <Logo label={t('home')} width={160} />
          </Link>
          {children}
        </main>
      </div>
    </ScopedIntl>
  );
}
