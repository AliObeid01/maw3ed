import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ClaudeSetupTeaser, OwnerBand, SetupSteps } from '@/components/home/OwnerSections';
import { PlansSection } from '@/components/home/PlansSection';
import { HashScroll } from '@/components/public/HashScroll';
import { pageMetadata } from '@/lib/seo';
import { ownerConnectorInfo } from '@/server/mcp/ownerUi';

// The teaser follows MCP_OWNER_ENABLED, which is read per request (never baked in at build time).
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('home.ownersPage');
  const common = await getTranslations('common');
  return pageMetadata({
    title: t('pageTitle'),
    description: t('metaDescription'),
    path: '/for-business',
    siteName: common('appName'),
  });
}

/** For business owners: the pitch, the five setup steps and the real Free / Pro plans (`#plans` is where the old /pricing redirects). */
export default async function ForBusinessPage() {
  const claudeTeaser = (await ownerConnectorInfo()) !== null;
  return (
    <main id="main-content" className="flex-1">
      <OwnerBand />
      <SetupSteps />
      {claudeTeaser ? <ClaudeSetupTeaser /> : null}
      <PlansSection />
      <HashScroll />
    </main>
  );
}
