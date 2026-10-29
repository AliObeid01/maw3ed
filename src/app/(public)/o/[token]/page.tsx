import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OfferView } from '@/components/waitlist/OfferView';

// The token is a bearer secret (it books a slot): keep it out of search indexes and Referer headers.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('offer');
  return { title: t('pageTitle'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function OfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <OfferView token={token} />;
}
