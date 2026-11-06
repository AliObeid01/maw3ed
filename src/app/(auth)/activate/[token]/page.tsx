import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ActivateView } from '@/components/auth/ActivateView';

// The token is a bearer secret: keep it out of Referer headers and search indexes.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('activation');
  return { title: t('title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function ActivatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ActivateView token={token} />;
}
