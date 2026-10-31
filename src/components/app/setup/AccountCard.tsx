'use client';

import { CircleAlert, LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { PasswordField, PasswordStrength } from '@/components/auth/PasswordField';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { ConfirmSheet } from '../ConfirmSheet';
import { useToast } from '@/components/ui/Toast';
import { ApiError, changePassword } from '@/lib/api/auth';
import { signOutOtherSessions } from '@/lib/api/team';
import { PASSWORD_MAX, PASSWORD_MIN } from '@/lib/auth/password';

type Errors = { current?: string; next?: string };

/** Settings > Account: change the password. This device stays signed in, every other session is ended. */
export function AccountCard() {
  const t = useTranslations('app.settings.account');
  const toast = useToast();
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<string>();
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [others, setOthers] = useState<{ text: string; failed: boolean }>();

  const focusFirstInvalid = () =>
    requestAnimationFrame(() =>
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
    );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setBanner(undefined);
    const found: Errors = {};
    if (!current) found.current = t('errors.currentRequired');
    const length = Array.from(next).length;
    if (length === 0) found.next = t('errors.newRequired');
    else if (length > PASSWORD_MAX) found.next = t('errors.newLong', { max: PASSWORD_MAX });
    else if (length < PASSWORD_MIN) found.next = t('errors.newShort', { min: PASSWORD_MIN });
    setErrors(found);
    if (found.current || found.next) {
      focusFirstInvalid();
      return;
    }

    setPending(true);
    try {
      await changePassword({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setErrors({});
      toast.show(t('saved'));
    } catch (error) {
      if (error instanceof ApiError && error.status === 400 && 'currentPassword' in error.fields) {
        setErrors({ current: t('errors.currentWrong') });
        focusFirstInvalid();
      } else if (error instanceof ApiError && error.status === 400 && 'newPassword' in error.fields) {
        setErrors({ next: t('errors.newShort', { min: PASSWORD_MIN }) });
        focusFirstInvalid();
      } else if (error instanceof ApiError && error.status === 429) {
        setBanner(t('errors.rateLimited'));
      } else if (error instanceof ApiError && error.code === 'NETWORK') {
        setBanner(t('errors.network'));
      } else {
        setBanner(t('errors.generic'));
      }
    } finally {
      setPending(false);
    }
  }

  async function signOutOthers() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const { removed } = await signOutOtherSessions();
      const text = t('others.done', { count: removed });
      setOthers({ text, failed: false });
      toast.show(text);
    } catch (error) {
      const text =
        error instanceof ApiError && error.status === 429
          ? t('errors.rateLimited')
          : error instanceof ApiError && error.code === 'NETWORK'
            ? t('errors.network')
            : t('errors.generic');
      setOthers({ text, failed: true });
      toast.show(text, 'error');
    } finally {
      setSigningOut(false);
      setConfirmOpen(false);
    }
  }

  return (
    <Card
      padding="none"
      as="section"
      aria-labelledby={`${uid}-account`}
      className="mt-5 flex flex-col gap-4 p-[22px] lg:max-w-[calc(50%-10px)]"
    >
      <div className="flex flex-col gap-1">
        <h2 id={`${uid}-account`} className="m-0 text-lg font-semibold">
          {t('title')}
        </h2>
        <p className="m-0 text-sm text-muted">{t('body')}</p>
      </div>
      <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-4">
        {banner ? (
          <div role="alert">
            <Callout tone="danger" icon={<CircleAlert />}>
              {banner}
            </Callout>
          </div>
        ) : null}
        <PasswordField
          label={t('current')}
          name="currentPassword"
          value={current}
          onChange={(e) => {
            setCurrent(e.target.value);
            setErrors((prev) => ({ ...prev, current: undefined }));
          }}
          autoComplete="current-password"
          error={errors.current}
          readOnly={pending}
        />
        <div className="flex flex-col gap-2">
          <PasswordField
            label={t('new')}
            name="newPassword"
            value={next}
            onChange={(e) => {
              setNext(e.target.value);
              setErrors((prev) => ({ ...prev, next: undefined }));
            }}
            autoComplete="new-password"
            error={errors.next}
            readOnly={pending}
          />
          <PasswordStrength id={`${uid}-strength`} password={next} />
        </div>
        <Button type="submit" size="lg" loading={pending} className="self-start">
          {t('submit')}
        </Button>
      </form>

      <div className="flex flex-col gap-3 border-t border-row pt-4">
        <div className="flex flex-col gap-1">
          <h3 className="m-0 text-base font-semibold">{t('others.title')}</h3>
          <p className="m-0 text-sm text-muted">{t('others.body')}</p>
        </div>
        <Button
          variant="secondary"
          size="lg"
          className="self-start"
          onClick={() => setConfirmOpen(true)}
        >
          <LogOut size={18} aria-hidden="true" className="rtl:-scale-x-100" />
          {t('others.cta')}
        </Button>
        <p
          aria-live="polite"
          className={others?.failed ? 'm-0 text-sm text-danger' : 'm-0 text-sm text-muted'}
        >
          {others?.text}
        </p>
      </div>

      <ConfirmSheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('others.confirmTitle')}
        description={t('others.confirmBody')}
        confirmLabel={t('others.confirm')}
        cancelLabel={t('others.cancel')}
        closeLabel={t('others.close')}
        pending={signingOut}
        onConfirm={signOutOthers}
      />
    </Card>
  );
}
