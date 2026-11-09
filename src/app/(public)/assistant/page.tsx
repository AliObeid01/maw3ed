import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AssistantPage } from '@/components/assistant/AssistantPage';
import { connectorUrl, isAssistantEnabled } from '@/lib/assistant';
import { pageMetadata } from '@/lib/seo';

// The kill switch is read per request (flip MCP_ENABLED in Vercel, then redeploy): never prerendered.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  if (!isAssistantEnabled()) return {};
  const t = await getTranslations('assistant');
  const common = await getTranslations('common');
  return pageMetadata({
    title: t('pageTitle'),
    description: t('metaDescription'),
    path: '/assistant',
    siteName: common('appName'),
  });
}

/** How to book by chatting with Claude. A 404 while the connector is switched off (`MCP_ENABLED` is not `true`). */
export default function Page() {
  if (!isAssistantEnabled()) notFound();
  return (
    <main id="main-content" className="flex-1">
      <AssistantPage connectorUrl={connectorUrl()} />
    </main>
  );
}
