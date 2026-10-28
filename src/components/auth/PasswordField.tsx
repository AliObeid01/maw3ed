'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Input, type InputProps } from '@/components/ui/Field';
import { PASSWORD_MAX, PASSWORD_MIN, passwordStrength, strengthLevel } from '@/lib/auth/password';
import { cn } from '@/lib/cn';

type PasswordFieldProps = Omit<InputProps, 'type' | 'endAdornment'>;

/** Password input with an accessible 44 px show/hide toggle. Passwords are LTR data, so the control stays LTR in Arabic. */
export function PasswordField({ className, ...props }: PasswordFieldProps) {
  const t = useTranslations('auth.password');
  const [visible, setVisible] = useState(false);
  return (
    <Input
      maxLength={PASSWORD_MAX}
      {...props}
      type={visible ? 'text' : 'password'}
      dir="ltr"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      className={cn('text-start', className)}
      endAdornment={
        <button
          type="button"
          aria-label={visible ? t('hide') : t('show')}
          onClick={() => setVisible((v) => !v)}
          className="inline-flex size-11 items-center justify-center rounded-pill text-muted transition-colors duration-200 ease-out hover:text-ink"
        >
          {visible ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
        </button>
      }
    />
  );
}

const segmentTone = {
  weak: 'bg-danger',
  fair: 'bg-accent',
  strong: 'bg-success',
} as const;

/** Three-segment length meter plus a polite text status. Length only: no composition rules. */
export function PasswordStrength({
  password,
  id,
  quiet = false,
}: {
  password: string;
  id: string;
  /** Meter only, hidden from assistive tech and without text (invite: an existing account may have a shorter password). */
  quiet?: boolean;
}) {
  const t = useTranslations('auth.password');
  const strength = passwordStrength(password);
  const level = strengthLevel(strength);
  return (
    <div
      id={id}
      className="flex flex-col gap-1.5"
      role={quiet ? undefined : 'group'}
      aria-label={quiet ? undefined : t('strengthLabel')}
      aria-hidden={quiet || undefined}
    >
      <div className="flex gap-1.5" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={cn(
              'h-1 flex-1 rounded-pill bg-divider transition-colors duration-200 ease-out',
              strength !== 'empty' && n <= level && (quiet ? 'bg-brand' : segmentTone[strength]),
            )}
          />
        ))}
      </div>
      {quiet ? null : (
        <p className="m-0 min-h-[19px] text-[13px] text-muted" aria-live="polite">
          {t(strength === 'empty' ? 'hint' : strength, { min: PASSWORD_MIN })}
        </p>
      )}
    </div>
  );
}
