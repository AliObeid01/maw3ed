'use client';

import { AlertCircle, LinkIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { activateAccount, ApiError, checkActivation } from '@/lib/api/auth';
import { PASSWORD_MAX, PASSWORD_MIN } from '@/lib/auth/password';
import { createSubmitGuard } from '@/lib/auth/submitGuard';
import { AuthCard, AuthHeading } from './AuthCard';
import { PasswordField, PasswordStrength } from './PasswordField';

type Problem = 'required' | 'short' | 'long';
type Banner = 'rateLimited' | 'network' | 'generic';
type State = 'checking' | 'form' | 'invalid';

/**
 * /activate/[token]: a staff member (barber) opens the one-time link the owner sent on WhatsApp and chooses their own
 * password (same rules as signup). The page reveals nothing about the business or the person: a link that is not
 * usable (unknown, used, expired, replaced) only ever says "not valid or expired".
 */
export function ActivateView({ token }: { token: string }) {
  const t = useTranslations('activation');
  const router = useRouter();
  const guard = useRef(createSubmitGuard());
  const [state, setState] = useState<State>('checking');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<Problem>();
  const [banner, setBanner] = useState<Banner>();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    checkActivation(token, controller.signal).then(
      () => setState('form'),
      (error) => {
        if (controller.signal.aborted) return;
        // Only a clear "not found" is a dead link; a network or rate-limit problem still shows the form.
        setState(error instanceof ApiError && error.status === 404 ? 'invalid' : 'form');
      },
    );
    return () => controller.abort();
  }, [token]);

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
      await activateAccount(token, password);
      router.replace('/app/welcome');
    } catch (error) {
      guard.current.release();
      setPending(false);
      if (error instanceof ApiError && error.status === 404) setState('invalid');
      else if (error instanceof ApiError && error.status === 400) setProblem('short');
      else if (error instanceof ApiError && error.status === 429) setBanner('rateLimited');
      else if (error instanceof ApiError && error.code === 'NETWORK') setBanner('network');
      else setBanner('generic');
    }
  }

  if (state === 'checking')
    return (
      <AuthCard className="items-center text-center">
        <p role="status" className="m-0 text-[15px] text-muted">
          {t('checking')}
        </p>
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
        <ButtonLink href="/login" size="lg" block className="h-[54px] text-base">
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
          <PasswordStrength id="activate-password-strength" password={password} />
        </div>
        <Button type="submit" size="lg" block loading={pending} className="mt-1 h-[54px] text-base">
          {t('submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
