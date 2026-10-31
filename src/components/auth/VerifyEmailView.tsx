'use client';

import { CircleCheck, LinkIcon, Mail, WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Button, ButtonLink } from '@/components/ui/Button';
import { ApiError, verifyEmail } from '@/lib/api/auth';
import { createSubmitGuard } from '@/lib/auth/submitGuard';
import { AuthCard } from './AuthCard';

type State =
  | { status: 'ready' }
  | { status: 'done' }
  | { status: 'invalid' }
  | { status: 'error'; message: 'networkError' | 'genericError' | 'rateLimited' };

/**
 * Opening the emailed link only shows this page: nothing is confirmed until the button is pressed (mail
 * scanners and link previews prefetch links with GET, so GET must not change state).
 */
export function VerifyEmailView({ token }: { token: string }) {
  const t = useTranslations('verify.page');
  const [state, setState] = useState<State>({ status: 'ready' });
  const [pending, setPending] = useState(false);
  const guard = useRef(createSubmitGuard());

  async function confirm() {
    if (!guard.current.tryStart()) return;
    setPending(true);
    try {
      await verifyEmail(token);
      setState({ status: 'done' });
    } catch (error) {
      guard.current.release();
      setPending(false);
      if (error instanceof ApiError && (error.status === 410 || error.status === 400))
        setState({ status: 'invalid' });
      else if (error instanceof ApiError && error.code === 'NETWORK')
        setState({ status: 'error', message: 'networkError' });
      else if (error instanceof ApiError && error.status === 429)
        setState({ status: 'error', message: 'rateLimited' });
      else setState({ status: 'error', message: 'genericError' });
    }
  }

  if (state.status === 'done')
    return (
      <AuthCard className="items-center text-center">
        <Badge tone="brand">
          <CircleCheck size={26} aria-hidden="true" />
        </Badge>
        <div className="flex flex-col gap-1" role="status">
          <h1 className="m-0 text-xl font-semibold">{t('successTitle')}</h1>
          <p className="m-0 text-[15px] text-muted">{t('successBody')}</p>
        </div>
        <ButtonLink href="/app" size="lg" block className="h-[54px] text-base">
          {t('successAction')}
        </ButtonLink>
      </AuthCard>
    );

  if (state.status === 'invalid')
    return (
      <AuthCard className="items-center text-center">
        <Badge tone="brand">
          <LinkIcon size={26} aria-hidden="true" />
        </Badge>
        <div className="flex flex-col gap-1" role="alert">
          <h1 className="m-0 text-xl font-semibold">{t('invalidTitle')}</h1>
          <p className="m-0 text-[15px] text-muted">{t('invalidBody')}</p>
        </div>
        {/* Signing in lands on the dashboard, where the banner offers "Resend email". */}
        <ButtonLink href="/app" size="lg" block className="h-[54px] text-base">
          {t('invalidAction')}
        </ButtonLink>
      </AuthCard>
    );

  return (
    <AuthCard className="items-center text-center">
      <Badge tone={state.status === 'error' ? 'warning' : 'brand'}>
        {state.status === 'error' ? (
          <WifiOff size={26} aria-hidden="true" />
        ) : (
          <Mail size={26} aria-hidden="true" />
        )}
      </Badge>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-xl font-semibold">{t('title')}</h1>
        <p className="m-0 text-[15px] text-muted">{t('body')}</p>
      </div>
      {state.status === 'error' ? (
        <p role="alert" className="m-0 text-sm font-medium text-danger">
          {t(state.message)}
        </p>
      ) : null}
      <Button size="lg" block loading={pending} onClick={confirm} className="h-[54px] text-base">
        {t('confirm')}
      </Button>
    </AuthCard>
  );
}

function Badge({ tone, children }: { tone: 'brand' | 'warning'; children: React.ReactNode }) {
  return (
    <span
      className={
        tone === 'brand'
          ? 'flex size-14 items-center justify-center rounded-[18px] bg-brand-soft text-brand'
          : 'flex size-14 items-center justify-center rounded-[18px] bg-warning-soft text-warning'
      }
    >
      {children}
    </span>
  );
}
