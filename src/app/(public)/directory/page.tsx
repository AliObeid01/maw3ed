import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DirectoryView } from '@/components/public/DirectoryView';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('directory');
  return { title: t('pageTitle'), description: t('subtitle') };
}

/** Listings are loaded in the browser (public API + skeleton), so the server shell stays static and cheap. */
export default function DirectoryPage() {
  return <DirectoryView />;
}
