'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { login } from '@/lib/api/auth';
import { createSubmitGuard } from '@/lib/auth/submitGuard';
import { classifyAuthError, type BannerKey } from '@/lib/auth/errors';
import { validateLogin, type LoginField } from '@/lib/auth/validation';
import { FormBanner, useErrorText, useFocusFirstInvalid, type FieldError } from './formKit';
import { PasswordField } from './PasswordField';

const FIELDS: readonly LoginField[] = ['email', 'password'];

export function LoginForm() {
  const t = useTranslations('auth.login');
  const forgot = useTranslations('recovery.forgot')('link');
  const router = useRouter();
  const text = useErrorText();
  const formRef = useRef<HTMLFormElement>(null);
  const guard = useRef(createSubmitGuard());

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Partial<Record<LoginField, FieldError>>>({});
  const [banner, setBanner] = useState<BannerKey>();
  const [pending, setPending] = useState(false);
  const [tick, setTick] = useState(0);
  useFocusFirstInvalid(formRef, tick);

  const clear = (field: LoginField) =>
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();

    const found: Partial<Record<LoginField, FieldError>> = validateLogin({ email, password });
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
      await login({ email: email.trim(), password });
      router.replace('/app');
    } catch (error) {
      const result = classifyAuthError(error, FIELDS);
      setErrors(result.fields as Partial<Record<LoginField, FieldError>>);
      setBanner(result.banner);
      setTick((n) => n + 1);
      guard.current.release();
      setPending(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormBanner message={text.banner(banner)} />

      <Input
        label={t('email')}
        name="email"
        type="email"
        dir="ltr"
        inputMode="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          clear('email');
        }}
        placeholder={t('emailPlaceholder')}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        error={text.field(errors.email)}
        readOnly={pending}
      />

      <PasswordField
        label={t('password')}
        name="password"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          clear('password');
        }}
        autoComplete="current-password"
        error={text.field(errors.password)}
        readOnly={pending}
      />

      <Link
        href="/forgot-password"
        className="-mt-2 inline-flex min-h-11 items-center self-start text-sm font-semibold text-brand no-underline"
      >
        {forgot}
      </Link>

      <Button type="submit" size="lg" block loading={pending} className="mt-1 h-[54px] text-base">
        {t('submit')}
      </Button>
    </form>
  );
}
