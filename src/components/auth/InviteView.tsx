'use client';

import { LinkIcon, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { monogram } from '@/components/public/monogram';
import { ApiError, acceptInvite, getInvite, type Invite } from '@/lib/api/auth';
import { createSubmitGuard } from '@/lib/auth/submitGuard';
import { classifyAuthError, type BannerKey } from '@/lib/auth/errors';
import { validateAccept, type AcceptField } from '@/lib/auth/validation';
import { AuthCard, AuthHeading } from './AuthCard';
import { FormBanner, useFocusFirstInvalid, type FieldError } from './formKit';
import { useErrorText } from './useErrorText';
import { PasswordField, PasswordStrength } from './PasswordField';

type State =
  | { status: 'loading' }
  | { status: 'ready'; invite: Invite }
  | { status: 'expired' }
  | { status: 'error' };

const FIELDS: readonly AcceptField[] = ['name', 'password'];

/** Loads the invite, then shows the accept form, the "expired or used" state, or a retryable error. */
export function InviteView({ token }: { token: string }) {
  const t = useTranslations('auth.invite');
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getInvite(token, controller.signal)
      .then((invite) => setState({ status: 'ready', invite }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: error instanceof ApiError && error.status === 404 ? 'expired' : 'error',
        });
      });
    return () => controller.abort();
  }, [token, attempt]);

  return (
    <>
      {state.status === 'loading' ? <InviteSkeleton label={t('loading')} /> : null}
      {state.status === 'ready' ? (
        <AcceptCard
          token={token}
          invite={state.invite}
          onGone={() => setState({ status: 'expired' })}
        />
      ) : null}
      {state.status === 'expired' ? (
        <AuthCard className="items-center text-center">
          <span className="flex size-14 items-center justify-center rounded-[18px] bg-brand-soft text-brand">
            <LinkIcon size={26} aria-hidden="true" />
          </span>
          <div className="flex flex-col gap-1">
            <h1 className="m-0 text-xl font-semibold">{t('expiredTitle')}</h1>
            <p className="m-0 text-[15px] text-muted">{t('expiredBody')}</p>
          </div>
          <ButtonLink href="/login" size="lg" block className="h-[54px] text-base">
            {t('expiredAction')}
          </ButtonLink>
        </AuthCard>
      ) : null}
      {state.status === 'error' ? (
        <AuthCard className="items-center text-center">
          <span className="flex size-14 items-center justify-center rounded-[18px] bg-warning-soft text-warning">
            <WifiOff size={26} aria-hidden="true" />
          </span>
          <div className="flex flex-col gap-1" role="alert">
            <h1 className="m-0 text-xl font-semibold">{t('loadFailedTitle')}</h1>
            <p className="m-0 text-[15px] text-muted">{t('loadFailedBody')}</p>
          </div>
          <Button
            size="lg"
            block
            className="h-[54px] text-base"
            onClick={() => {
              setState({ status: 'loading' });
              setAttempt((n) => n + 1);
            }}
          >
            {t('retry')}
          </Button>
        </AuthCard>
      ) : null}

      <p className="m-0 text-sm text-muted">
        {t('haveAccount')}{' '}
        <Link
          href="/login"
          className="inline-flex min-h-11 min-w-11 items-center justify-center font-semibold no-underline"
        >
          {t('signIn')}
        </Link>
      </p>
    </>
  );
}

function InviteSkeleton({ label }: { label: string }) {
  return (
    <AuthCard className="gap-[18px]">
      <p role="status" className="sr-only">
        {label}
      </p>
      <Skeleton className="h-20 rounded-card-sm" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-5 w-1/2" />
      </div>
      <Skeleton className="h-[52px]" />
      <Skeleton className="h-[52px]" />
      <Skeleton className="h-[52px]" />
      <Skeleton className="h-[54px] rounded-btn" />
    </AuthCard>
  );
}

function AcceptCard({
  token,
  invite,
  onGone,
}: {
  token: string;
  invite: Invite;
  /** The invite was used or expired after the page loaded (404 on accept). */
  onGone: () => void;
}) {
  const t = useTranslations('auth.invite');
  const roles = useTranslations('auth.role');
  const format = useFormatter();
  const router = useRouter();
  const text = useErrorText();
  const formRef = useRef<HTMLFormElement>(null);
  const guard = useRef(createSubmitGuard());

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Partial<Record<AcceptField, FieldError>>>({});
  const [banner, setBanner] = useState<BannerKey>();
  const [pending, setPending] = useState(false);
  const [tick, setTick] = useState(0);
  // Read once on mount: relative expiry text must not change between renders.
  const [now] = useState(() => Date.now());
  useFocusFirstInvalid(formRef, tick);

  const role = invite.role.toLowerCase();
  const roleLabel = role === 'owner' || role === 'staff' ? roles(role) : roles('other');
  const expiresAt = new Date(invite.expiresAt);
  const expiry = Number.isNaN(expiresAt.getTime())
    ? null
    : t('expires', { when: format.relativeTime(expiresAt, now) });

  const clear = (field: AcceptField) =>
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();

    const found: Partial<Record<AcceptField, FieldError>> = validateAccept({ name, password });
    setBanner(undefined);
    if (Object.values(found).some(Boolean)) {
      setErrors(found);
      setTick((n) => n + 1);
      return;
    }

    if (!guard.current.tryStart()) return;
    setPending(true);
    setErrors({});
    try {
      await acceptInvite(token, { name: name.trim(), password });
      router.replace('/app');
    } catch (error) {
      const result = classifyAuthError(error, FIELDS, 'invite');
      if (result.gone) {
        onGone();
        return;
      }
      setErrors(result.fields as Partial<Record<AcceptField, FieldError>>);
      setBanner(result.banner);
      setTick((n) => n + 1);
      guard.current.release();
      setPending(false);
    }
  }

  return (
    <AuthCard className="gap-[18px] py-7">
      <div className="flex items-center gap-3.5 rounded-card-sm bg-canvas p-3.5">
        <span
          aria-hidden="true"
          className="flex size-[52px] shrink-0 items-center justify-center rounded-2xl bg-accent text-lg font-bold text-ink"
        >
          {monogram(invite.businessName)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm text-muted">{t('invitedTo')}</span>
          <span
            title={invite.businessName}
            className="line-clamp-2 text-xl leading-tight font-semibold break-words"
          >
            {invite.businessName}
          </span>
        </span>
        <span className="rounded-chip bg-brand-soft px-2.5 py-[5px] text-xs font-semibold text-brand">
          {roleLabel}
        </span>
      </div>

      <AuthHeading title={t('title')} subtitle={expiry} />

      <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormBanner
          message={text.banner(banner)}
          action={
            banner === 'alreadyMember' ? (
              <ButtonLink href="/login" variant="secondary">
                {t('goToSignIn')}
              </ButtonLink>
            ) : undefined
          }
        />

        <Input
          label={t('email')}
          type="email"
          dir="ltr"
          name="email"
          value={invite.email}
          readOnly
          autoComplete="username"
          className="bg-canvas text-muted"
        />

        <Input
          label={t('name')}
          name="name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            clear('name');
          }}
          autoComplete="name"
          error={text.field(errors.name)}
          readOnly={pending}
        />

        <div className="flex flex-col gap-2">
          <PasswordField
            label={t('password')}
            name="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clear('password');
            }}
            hint={t('passwordHint')}
            autoComplete="new-password"
            error={text.field(errors.password)}
            readOnly={pending}
          />
          {/* Hint only: an existing account may enter a current password shorter than the new-account minimum. */}
          <PasswordStrength id="invite-password-strength" password={password} quiet />
        </div>

        <Button
          type="submit"
          variant="accent"
          size="lg"
          block
          loading={pending}
          className="mt-1 h-[54px] text-base"
        >
          {t('submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
