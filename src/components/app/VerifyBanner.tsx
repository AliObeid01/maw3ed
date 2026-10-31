'use client';

import { MailWarning } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { ApiError, resendVerification } from '@/lib/api/auth';
import { useAppSession } from './SessionContext';

/**
 * Shown on every /app page while the signed-in user's email is unconfirmed (soft verification: the app works,
 * only inviting staff and listing in the directory wait). "Resend email" is rate limited server-side.
 */
export function VerifyBanner() {
  const { emailVerified } = useAppSession();
  const t = useTranslations('verify.banner');
  const toast = useToast();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  if (emailVerified) return null;

  async function resend() {
    if (pending) return;
    setPending(true);
    try {
      const res = await resendVerification();
      if (res.alreadyVerified) {
        toast.show(t('alreadyVerified'));
        router.refresh();
      } else {
        toast.show(t('sent'));
      }
    } catch (error) {
      toast.show(
        error instanceof ApiError && error.status === 429 ? t('rateLimited') : t('failed'),
        'error',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-label={t('label')}
      className="mb-4 flex flex-wrap items-center gap-3 rounded-[20px] border border-warning-line bg-warning-soft p-4 text-warning-deep"
    >
      <span aria-hidden="true" className="flex shrink-0">
        <MailWarning size={20} />
      </span>
      <p className="m-0 min-w-0 flex-[1_1_220px] text-sm leading-[1.45]">{t('text')}</p>
      <Button variant="secondary" loading={pending} onClick={resend}>
        {t('resend')}
      </Button>
    </section>
  );
}
