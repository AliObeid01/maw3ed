import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Logo } from '@/components/brand/Logo';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { Card } from '@/components/ui/Card';
import { getCurrentSession } from '@/server/http/session';
import { isOwnerConnectorEnabled } from '@/server/mcp/ownerConfig';
import { cleanText } from '@/server/mcp/sanitize';
import { checkAuthorizeRequest, signConsentToken, type AuthorizeParams } from '@/server/services/oauth';

// Per request: the flag, the session and the signed consent token all differ every time. Never cached.
export const dynamic = 'force-dynamic';

const KEYS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'state',
  'scope',
  'resource',
] as const;

type SearchParams = Record<string, string | string[] | undefined>;
/** Where the code goes, in words: the two Claude hosts by name, a loopback callback as a local app, anything else by host. */
function destination(redirectUri: string, local: (host: string) => string): string {
  const url = new URL(redirectUri);
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return local(url.host);
  return url.host;
}
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata(): Promise<Metadata> {
  if (!isOwnerConnectorEnabled()) return {};
  const t = await getTranslations();
  return { title: t('oauth.pageTitle'), robots: { index: false, follow: false } };
}

function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <main id="main-content" className="flex min-h-dvh flex-col items-center gap-5 px-4 pt-[72px] pb-8 md:justify-center md:py-8">
      <Logo label={label} width={160} />
      <Card as="section" className="flex w-full max-w-[440px] flex-col gap-4 rounded-card p-5 sm:p-6">
        {children}
      </Card>
    </main>
  );
}

/** The OAuth consent page. 404 while MCP_OWNER_ENABLED is off. Server-rendered, no client JavaScript. */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (!isOwnerConnectorEnabled()) notFound();
  const sp = await searchParams;
  const t = await getTranslations();
  const status = first(sp.status);

  const message = (title: string, body: string, back = false) => (
    <Frame label={t('common.appName')}>
      <h1 className="m-0 text-2xl font-semibold">{title}</h1>
      <p className="m-0 text-[15px] text-muted">{body}</p>
      {back ? (
        <Link href="/app" className={buttonClasses({ variant: 'secondary', size: 'lg', block: true })}>
          {t('oauth.errors.back')}
        </Link>
      ) : null}
    </Frame>
  );

  if (status === 'expired') return message(t('oauth.errors.expiredTitle'), t('oauth.errors.expired'));
  if (status === 'blocked') return message(t('oauth.errors.blockedTitle'), t('oauth.errors.blocked'), true);

  const params: AuthorizeParams = {};
  for (const k of KEYS) {
    const v = first(sp[k]);
    if (v !== undefined) params[k] = v;
  }
  const session = await getCurrentSession();

  if (status === 'not_owner') {
    if (!session) redirect('/login');
    return message(
      t('oauth.errors.notOwnerTitle'),
      t('oauth.errors.notOwner', { business: cleanText(session.businessName) }),
      true,
    );
  }

  // Bad client_id or redirect_uri: shown HERE, never redirected (nothing is sent to an unverified address).
  const check = await checkAuthorizeRequest(params);
  if (check.kind === 'page_error')
    return message(
      check.reason === 'client' ? t('oauth.errors.invalidClientTitle') : t('oauth.errors.invalidRedirectTitle'),
      check.reason === 'client' ? t('oauth.errors.invalidClient') : t('oauth.errors.invalidRedirect'),
    );
  if (check.kind === 'redirect_error') {
    const url = new URL(check.redirectUri);
    url.searchParams.set('error', check.error);
    if (check.state) url.searchParams.set('state', check.state);
    redirect(url.toString());
  }

  // Not signed in: sign in first, then come back to exactly this request (a same-origin path, validated by safeNext).
  if (!session) {
    const back = new URLSearchParams();
    for (const k of KEYS) if (params[k] !== undefined) back.set(k, params[k]);
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${back.toString()}`)}`);
  }

  // Only the OWNER of the signed-in business may connect Claude. No code is ever issued to anyone else.
  if (session.role !== 'OWNER')
    return message(
      t('oauth.errors.notOwnerTitle'),
      t('oauth.errors.notOwner', { business: cleanText(session.businessName) }),
      true,
    );

  const consent = signConsentToken({ userId: session.userId, businessId: session.businessId }, check);
  return (
    <Frame label={t('common.appName')}>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-2xl font-semibold md:text-[26px]">
          {t('oauth.title', { business: cleanText(session.businessName) })}
        </h1>
        <p className="m-0 text-[15px] text-muted">{t('oauth.intro')}</p>
        <p className="m-0 text-sm text-muted">{t('oauth.requestedBy', { client: cleanText(check.client.name, 60) })}</p>
        <p className="m-0 text-sm text-muted">
          {t('oauth.returnsTo', {
            destination: destination(check.redirectUri, (host) => t('oauth.localApp', { host })),
          })}
        </p>
      </div>
      <p className="m-0 rounded-input bg-warning-soft px-3.5 py-2.5 text-sm font-medium text-ink">{t('oauth.warning')}</p>
      <section className="flex flex-col gap-1.5">
        <h2 className="m-0 text-base font-semibold">{t('oauth.canTitle')}</h2>
        <ul className="m-0 flex list-disc flex-col gap-1 ps-5 text-[15px]">
          <li>{t('oauth.can1')}</li>
          <li>{t('oauth.can2')}</li>
        </ul>
      </section>
      <section className="flex flex-col gap-1.5">
        <h2 className="m-0 text-base font-semibold">{t('oauth.cannotTitle')}</h2>
        <ul className="m-0 flex list-disc flex-col gap-1 ps-5 text-[15px]">
          <li>{t('oauth.cannot1')}</li>
          <li>{t('oauth.cannot2')}</li>
          <li>{t('oauth.cannot3')}</li>
        </ul>
      </section>
      <p className="m-0 text-sm text-muted">{t('oauth.disconnect')}</p>
      <form method="post" action="/api/oauth/authorize" className="flex flex-col gap-3">
        <input type="hidden" name="consent" value={consent} />
        <button type="submit" name="decision" value="allow" className={buttonClasses({ variant: 'primary', size: 'lg', block: true })}>
          {t('oauth.allow')}
        </button>
        <button type="submit" name="decision" value="deny" className={buttonClasses({ variant: 'secondary', size: 'lg', block: true })}>
          {t('oauth.cancel')}
        </button>
      </form>
    </Frame>
  );
}
