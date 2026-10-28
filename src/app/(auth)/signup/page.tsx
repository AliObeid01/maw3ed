import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthCard, AuthHeading } from '@/components/auth/AuthCard';
import { AuthTabs } from '@/components/auth/AuthTabs';
import { SignupForm } from '@/components/auth/SignupForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.signup');
  return { title: t('title') };
}

export default async function SignupPage() {
  const t = await getTranslations();
  return (
    <>
      <AuthCard>
        <AuthTabs active="signup" />
        <AuthHeading title={t('auth.signup.title')} subtitle={t('auth.signup.subtitle')} />
        <SignupForm />
      </AuthCard>
      <p className="m-0 text-sm tracking-[0.08em] text-muted">{t('common.tagline')}</p>
    </>
  );
}
