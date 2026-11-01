import type { Metadata, Viewport } from 'next';
import { Outfit, IBM_Plex_Sans_Arabic } from 'next/font/google';
import { getLocale, getTranslations } from 'next-intl/server';
import { ScopedIntl } from '@/components/i18n/ScopedIntl';
import { defaultLocale, dirFor, isLocale } from '@/i18n/config';
import './globals.css';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-outfit',
  display: 'swap',
});

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-arabic',
  display: 'swap',
});

// viewport-fit=cover lets env(safe-area-inset-*) work for the tab bar and sticky CTAs.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#F7F5F0',
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
