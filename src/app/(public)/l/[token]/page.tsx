import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LinkView } from '@/components/links/LinkView';

// The token is a bearer secret (it can cancel an appointment): keep it out of search indexes and Referer headers.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('link');
  return { title: t('pageTitle'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function LinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <LinkView token={token} />;
}
