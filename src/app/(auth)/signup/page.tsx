import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthCard, AuthHeading } from '@/components/auth/AuthCard';
import { AuthTabs } from '@/components/auth/AuthTabs';
import { SignupForm } from '@/components/auth/SignupForm';
import { getCurrentSession } from '@/server/http/session';
import { loginHref, safePlan } from '@/lib/auth/safeNext';
import { redirect } from 'next/navigation';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.signup');
  return { title: t('title') };
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Only the whitelisted value "pro" is kept; anything else is ignored.
  const plan = safePlan((await searchParams).plan);
  // Someone who is already signed in and picked Pro in the plans on /for-business goes straight to the checkout.
  if (plan === 'pro') {
    const session = await getCurrentSession().catch(() => null);
    if (session) redirect(session.role === 'OWNER' ? '/app/checkout?plan=pro' : '/app');
  }
  const t = await getTranslations();
  return (
    <>
      <AuthCard className="md:max-w-[640px]">
        <AuthTabs
          active="signup"
          loginHref={plan === 'pro' ? loginHref('/app/checkout?plan=pro') : '/login'}
        />
        <AuthHeading title={t('auth.signup.title')} subtitle={t('auth.signup.subtitle')} />
        <SignupForm plan={plan} />
      </AuthCard>
      <p className="m-0 text-sm tracking-[0.08em] text-muted">{t('common.tagline')}</p>
    </>
  );
}
