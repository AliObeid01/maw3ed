import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { BookingFlow } from '@/components/booking/BookingFlow';
import { isAssistantEnabled } from '@/lib/assistant';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('booking');
  return { title: t('pageTitle') };
}

/** The business is loaded in the browser (public API + skeleton), so the server shell stays static and cheap. */
export default async function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Suspense>
      <BookingFlow slug={slug} assistantEnabled={isAssistantEnabled()} />
    </Suspense>
  );
}
