import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MyBookingsView } from '@/components/myBookings/MyBookingsView';

/** Personal and device-local: keep it out of search indexes. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('myBookings');
  return { title: t('pageTitle'), robots: { index: false, follow: false } };
}

/** "My bookings on this device": the server sends the heading, the list is read from this browser (localStorage). */
export default async function MyBookingsPage() {
  const t = await getTranslations('myBookings');
  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-[1000px] flex-1 flex-col gap-6 px-4 py-8 md:px-8 md:py-12"
    >
      <header className="flex flex-col gap-2">
        <h1 className="m-0 text-[clamp(28px,5vw,42px)] leading-[1.12] font-bold tracking-[-0.02em] rtl:tracking-normal">
          {t('title')}
        </h1>
        <p className="m-0 max-w-xl text-[15px] text-muted md:text-[17px]">{t('subtitle')}</p>
      </header>
      <MyBookingsView />
    </main>
  );
}
