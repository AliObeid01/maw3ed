import type { Metadata, Viewport } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { ScopedIntl } from '@/components/i18n/ScopedIntl';
import { defaultLocale, dirFor, isLocale } from '@/i18n/config';
import { outfit, plexArabic } from './fonts';
import './globals.css';

// viewport-fit=cover lets env(safe-area-inset-*) work for the tab bar and sticky CTAs.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#F3F5FA',
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common');
  return { title: t('appName'), description: t('tagline') };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const raw = await getLocale();
  const locale = isLocale(raw) ? raw : defaultLocale;
  return (
    <html
      lang={locale}
      dir={dirFor(locale)}
      className={`${outfit.variable} ${plexArabic.variable}`}
    >
      <body>
        {/* Route-group layouts nest a ScopedIntl with their own namespaces (and the business zone). */}
        <ScopedIntl scope="root">{children}</ScopedIntl>
      </body>
    </html>
  );
}
