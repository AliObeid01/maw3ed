import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('recovery.forgot');
  return { title: t('title') };
}

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
