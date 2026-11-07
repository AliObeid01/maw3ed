import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LegalDocument } from '@/components/legal/LegalDocument';
import { TERMS_SECTIONS } from '@/lib/legal';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal.terms');
  const common = await getTranslations('common');
  return pageMetadata({ title: t('pageTitle'), description: t('intro'), path: '/terms', siteName: common('appName') });
}

export default function TermsPage() {
  return <LegalDocument doc="terms" sections={TERMS_SECTIONS} />;
}
