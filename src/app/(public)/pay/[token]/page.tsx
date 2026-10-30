import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PayView } from '@/components/pay/PayView';

// The token is a bearer secret (it pays for a held slot): keep it out of search indexes and Referer headers.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('deposit');
  return { title: t('pageTitle'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PayView token={token} />;
}
