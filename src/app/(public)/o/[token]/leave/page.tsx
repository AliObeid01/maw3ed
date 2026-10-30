import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LeaveWaitlist } from '@/components/waitlist/LeaveWaitlist';

// The token is a bearer secret: keep it out of search indexes and Referer headers. Opening the page
// changes nothing (email scanners fetch links); removal is a POST on the button.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('offer.leave');
  return { title: t('pageTitle'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function LeavePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <LeaveWaitlist token={token} />;
}
