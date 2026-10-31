'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { PasswordField, PasswordStrength } from '@/components/auth/PasswordField';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { ApiError, changePassword } from '@/lib/api/auth';
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
    </Card>
  );
}
