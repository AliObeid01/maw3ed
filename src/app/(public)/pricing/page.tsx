import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PricingView } from '@/components/pricing/PricingView';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pricing');
  return { title: t('pageTitle') };
}

export default function PricingPage() {
  return <PricingView />;
}
