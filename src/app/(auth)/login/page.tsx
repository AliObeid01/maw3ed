import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthCard, AuthHeading } from '@/components/auth/AuthCard';
import { AuthTabs } from '@/components/auth/AuthTabs';
import { LoginForm } from '@/components/auth/LoginForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.login');
  return { title: t('submit') };
}

export default async function LoginPage() {
  const t = await getTranslations();
  return (
    <>
      <AuthCard>
        <AuthTabs active="login" />
        <AuthHeading title={t('auth.login.title')} subtitle={t('auth.login.subtitle')} />
        <LoginForm />
      </AuthCard>
      <p className="m-0 text-sm tracking-[0.08em] text-muted">{t('common.tagline')}</p>
    </>
  );
}
