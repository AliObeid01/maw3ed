import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { JoinWaitlist } from '@/components/waitlist/JoinWaitlist';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('waitlist');
  return { title: t('pageTitle') };
}

export default async function WaitlistPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Suspense>
      <JoinWaitlist slug={slug} />
    </Suspense>
  );
}
