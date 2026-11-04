'use client';

import { AlertCircle, CircleCheck, LinkIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { ButtonLink, Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { ApiError, resetPassword } from '@/lib/api/auth';
import { PASSWORD_MAX, PASSWORD_MIN } from '@/lib/auth/password';
import { createSubmitGuard } from '@/lib/auth/submitGuard';
import { AuthCard, AuthHeading } from './AuthCard';
import { PasswordField, PasswordStrength } from './PasswordField';

type Problem = 'required' | 'short' | 'long';
type Banner = 'rateLimited' | 'network' | 'generic';
type State = 'form' | 'done' | 'invalid';

/** Same password rules as signup (10 to 128 characters). Opening the link shows the form; only the POST changes anything. */
export function ResetPasswordView({ token }: { token: string }) {
  const t = useTranslations('recovery.reset');
  const guard = useRef(createSubmitGuard());
  const [state, setState] = useState<State>('form');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<Problem>();
  const [banner, setBanner] = useState<Banner>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBanner(undefined);
    const length = Array.from(password).length;
    const found: Problem | undefined =
      length === 0 ? 'required' : length > PASSWORD_MAX ? 'long' : length < PASSWORD_MIN ? 'short' : undefined;
    setProblem(found);
    if (found) return;
    if (!guard.current.tryStart()) return;
    setPending(true);
    try {
      await resetPassword({ token, newPassword: password });
      setState('done');
    } catch (error) {
      guard.current.release();
      setPending(false);
      if (error instanceof ApiError && error.status === 410) setState('invalid');
      else if (error instanceof ApiError && error.status === 400) setProblem('short');
      else if (error instanceof ApiError && error.status === 429) setBanner('rateLimited');
      else if (error instanceof ApiError && error.code === 'NETWORK') setBanner('network');
      else setBanner('generic');
    }
  }

  if (state === 'done')
    return (
      <AuthCard className="items-center text-center">
        <span className="flex size-14 items-center justify-center rounded-[18px] bg-brand-soft text-brand">
          <CircleCheck size={26} aria-hidden="true" />
        </span>
        <div className="flex flex-col gap-1" role="status">
          <h1 className="m-0 text-xl font-semibold">{t('successTitle')}</h1>
          <p className="m-0 text-[15px] text-muted">{t('successBody')}</p>
        </div>
        <ButtonLink href="/login" size="lg" block className="h-[54px] text-base">
          {t('signIn')}
        </ButtonLink>
      </AuthCard>
    );

  if (state === 'invalid')
    return (
      <AuthCard className="items-center text-center">
        <span className="flex size-14 items-center justify-center rounded-[18px] bg-brand-soft text-brand">
          <LinkIcon size={26} aria-hidden="true" />
        </span>
        <div className="flex flex-col gap-1" role="alert">
          <h1 className="m-0 text-xl font-semibold">{t('invalidTitle')}</h1>
          <p className="m-0 text-[15px] text-muted">{t('invalidBody')}</p>
        </div>
        <ButtonLink href="/forgot-password" size="lg" block className="h-[54px] text-base">
          {t('invalidAction')}
        </ButtonLink>
      </AuthCard>
    );

  return (
    <AuthCard>
      <AuthHeading title={t('title')} subtitle={t('subtitle', { min: PASSWORD_MIN })} />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {banner ? (
          <div role="alert">
            <Callout tone="danger" icon={<AlertCircle />}>
              {t(`errors.${banner}`)}
            </Callout>
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <PasswordField
            label={t('password')}
            name="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setProblem(undefined);
            }}
            placeholder={t('passwordPlaceholder', { min: PASSWORD_MIN })}
            autoComplete="new-password"
            error={problem ? t(`errors.${problem}`, { min: PASSWORD_MIN, max: PASSWORD_MAX }) : undefined}
            readOnly={pending}
          />
          <PasswordStrength id="reset-password-strength" password={password} />
        </div>
        <Button type="submit" size="lg" block loading={pending} className="mt-1 h-[54px] text-base">
          {t('submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
