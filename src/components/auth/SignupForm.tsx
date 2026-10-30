'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { signup } from '@/lib/api/auth';
import { createSubmitGuard } from '@/lib/auth/submitGuard';
import { classifyAuthError, type BannerKey } from '@/lib/auth/errors';
import { PASSWORD_MIN } from '@/lib/auth/password';
import { normalizeSlugInput, suggestSlug } from '@/lib/auth/slug';
import {
  DEFAULT_TIMEZONE,
  allTimezones,
  timezoneGroups,
  timezoneLabel,
} from '@/lib/auth/timezones';
import { validateSignup, type SignupField } from '@/lib/auth/validation';
import { FormBanner, useErrorText, useFocusFirstInvalid, type FieldError } from './formKit';
import { PasswordField, PasswordStrength } from './PasswordField';
import { SlugField, useSlugAvailability } from './SlugField';

const FIELDS: readonly SignupField[] = [
  'businessName',
  'slug',
  'ownerName',
  'email',
  'password',
  'timezone',
];

const noopSubscribe = () => () => {};
const NO_ZONES: string[] = [];
let cachedZones: string[] | undefined;
/** Stable reference per page load, as useSyncExternalStore requires. */
const clientTimezones = () => (cachedZones ??= allTimezones());

export function SignupForm() {
  const t = useTranslations('auth.signup');
  const router = useRouter();
  const text = useErrorText();
  const ids = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const guard = useRef(createSubmitGuard());

  const [businessName, setBusinessName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  // Server list is read after mount: Intl.supportedValuesOf can differ between server and browser.
  const allZones = useSyncExternalStore(noopSubscribe, clientTimezones, () => NO_ZONES);
  const zones = timezoneGroups(allZones);

  const [errors, setErrors] = useState<Partial<Record<SignupField, FieldError>>>({});
  const [banner, setBanner] = useState<BannerKey>();
  const [pending, setPending] = useState(false);
  const [tick, setTick] = useState(0);
  useFocusFirstInvalid(formRef, tick);

  const slugStatus = useSlugAvailability(slug);

  const clear = (field: SignupField) =>
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();

    const found: Partial<Record<SignupField, FieldError>> = validateSignup({
      businessName,
      slug,
      ownerName,
      email,
      password,
    });
    if (!found.slug && slugStatus === 'taken') found.slug = { key: 'slugTaken' };
    if (!found.slug && slugStatus === 'reserved') found.slug = { key: 'slugReserved' };
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
      await signup({
        businessName: businessName.trim(),
        slug,
        timezone,
        ownerName: ownerName.trim(),
        email: email.trim(),
        password,
      });
      // Keep the button busy until the navigation lands.
      router.replace('/app/setup');
    } catch (error) {
      const result = classifyAuthError(error, FIELDS);
      setErrors(result.fields as Partial<Record<SignupField, FieldError>>);
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
        label={t('businessName')}
        name="businessName"
        value={businessName}
        onChange={(e) => {
          setBusinessName(e.target.value);
          clear('businessName');
          if (!slugEdited) setSlug(suggestSlug(e.target.value));
        }}
        placeholder={t('businessNamePlaceholder')}
        autoComplete="organization"
        error={text.field(errors.businessName)}
        readOnly={pending}
      />

      <SlugField
        id={`${ids}-slug`}
        label={t('slug')}
        value={slug}
        onChange={(raw) => {
          const next = normalizeSlugInput(raw);
          setSlug(next);
          setSlugEdited(next !== '');
          clear('slug');
        }}
        placeholder={t('slugPlaceholder')}
        status={slugStatus}
        error={text.field(errors.slug)}
        readOnly={pending}
      />

      <Input
        label={t('ownerName')}
        name="ownerName"
        value={ownerName}
        onChange={(e) => {
          setOwnerName(e.target.value);
          clear('ownerName');
        }}
        autoComplete="name"
        error={text.field(errors.ownerName)}
        readOnly={pending}
      />

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
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        error={text.field(errors.email)}
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
          placeholder={t('passwordPlaceholder', { min: PASSWORD_MIN })}
          autoComplete="new-password"
          aria-describedby={`${ids}-strength`}
          error={text.field(errors.password)}
          readOnly={pending}
        />
        <PasswordStrength id={`${ids}-strength`} password={password} />
      </div>

      <Select
        label={t('timezone')}
        name="timezone"
        value={timezone}
        onChange={(e) => {
          if (guard.current.isBusy()) return;
          setTimezone(e.target.value);
          clear('timezone');
        }}
        hint={t('timezoneHint')}
        error={text.field(errors.timezone)}
        aria-disabled={pending || undefined}
      >
        <optgroup label={t('timezoneCommon')}>
          {zones.common.map((z) => (
            <option key={z} value={z}>
              {timezoneLabel(z)}
            </option>
          ))}
        </optgroup>
        {zones.rest.length > 0 ? (
          <optgroup label={t('timezoneAll')}>
            {zones.rest.map((z) => (
              <option key={z} value={z}>
                {timezoneLabel(z)}
              </option>
            ))}
          </optgroup>
        ) : null}
      </Select>

      <Button type="submit" size="lg" block loading={pending} className="mt-1 h-[54px] text-base">
        {t('submit')}
      </Button>
    </form>
  );
}
