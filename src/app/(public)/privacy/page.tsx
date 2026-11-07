import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LegalDocument } from '@/components/legal/LegalDocument';
import { PRIVACY_SECTIONS } from '@/lib/legal';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal.privacy');
  const common = await getTranslations('common');
  return pageMetadata({ title: t('pageTitle'), description: t('intro'), path: '/privacy', siteName: common('appName') });
}

export default function PrivacyPage() {
  return <LegalDocument doc="privacy" sections={PRIVACY_SECTIONS} />;
}
