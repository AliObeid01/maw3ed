'use client';

import { AlertCircle, MailCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Input } from '@/components/ui/Field';
import { ApiError, forgotPassword } from '@/lib/api/auth';
import { createSubmitGuard } from '@/lib/auth/submitGuard';
import { isEmail } from '@/lib/auth/validation';
import { AuthCard, AuthHeading } from './AuthCard';

type Problem = 'required' | 'email';
type Banner = 'rateLimited' | 'network' | 'generic';

/**
 * Asks for a reset link. Whatever the server says about the address, success looks the same ("if an account
 * exists..."), so the page never reveals whether an email is registered.
 */
export function ForgotPasswordForm() {
  const t = useTranslations('recovery.forgot');
  const guard = useRef(createSubmitGuard());
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState<Problem>();
  const [banner, setBanner] = useState<Banner>();
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBanner(undefined);
    const value = email.trim();
    const found: Problem | undefined = !value ? 'required' : isEmail(value) ? undefined : 'email';
    setProblem(found);
    if (found) return;
    if (!guard.current.tryStart()) return;
    setPending(true);
    try {
      await forgotPassword(value);
      setSent(true);
    } catch (error) {
      guard.current.release();
      setPending(false);
      if (error instanceof ApiError && error.status === 429) setBanner('rateLimited');
      else if (error instanceof ApiError && error.code === 'NETWORK') setBanner('network');
      else setBanner('generic');
    }
  }

  if (sent)
    return (
      <AuthCard className="items-center text-center">
        <span className="flex size-14 items-center justify-center rounded-[18px] bg-brand-soft text-brand">
          <MailCheck size={26} aria-hidden="true" />
        </span>
        <div className="flex flex-col gap-1" role="status">
          <h1 className="m-0 text-xl font-semibold">{t('sentTitle')}</h1>
          <p className="m-0 text-[15px] text-muted">{t('sentBody')}</p>
        </div>
        <ButtonLink href="/login" variant="secondary" size="lg" block className="h-[54px] text-base">
          {t('back')}
        </ButtonLink>
      </AuthCard>
    );

  return (
    <AuthCard>
      <AuthHeading title={t('title')} subtitle={t('subtitle')} />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {banner ? (
          <div role="alert">
            <Callout tone="danger" icon={<AlertCircle />}>
              {t(`errors.${banner}`)}
            </Callout>
          </div>
        ) : null}
        <Input
          label={t('email')}
          name="email"
          type="email"
          dir="ltr"
          inputMode="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setProblem(undefined);
          }}
          placeholder={t('emailPlaceholder')}
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          error={problem ? t(`errors.${problem}`) : undefined}
          readOnly={pending}
        />
        <Button type="submit" size="lg" block loading={pending} className="mt-1 h-[54px] text-base">
          {t('submit')}
        </Button>
        <ButtonLink href="/login" variant="secondary" size="lg" block className="h-[54px] text-base">
          {t('back')}
        </ButtonLink>
      </form>
    </AuthCard>
  );
}
