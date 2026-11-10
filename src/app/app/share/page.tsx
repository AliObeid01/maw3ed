import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { ShareView } from '@/components/app/setup/ShareView';
import { isAssistantEnabled } from '@/lib/assistant';
import { assertPractitionerPath } from '@/app/app/practitionerGuard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.titles');
  return { title: t('share') };
}

/**
 * The connector switch, as `isAssistantEnabled()` says. TEST-ONLY addition, like the fake session in loadSession.ts:
 * under E2E_FAKE_SESSION=1 (which the app refuses to run with in production) the cookie `e2e_mcp=off` makes ONE dev
 * server answer as a server without the flag, so the dashboard e2e proves both states. It can only turn the card off.
 */
async function assistantEnabled(): Promise<boolean> {
  if (!isAssistantEnabled()) return false;
  if (process.env.E2E_FAKE_SESSION === '1' && (await cookies()).get('e2e_mcp')?.value === 'off') return false;
  return true;
}

export default async function Page() {
  await assertPractitionerPath('/app/share');
  return <ShareView assistantEnabled={await assistantEnabled()} />;
}
