'use client';

import { AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, type RefObject } from 'react';
import { Callout } from '@/components/ui/Callout';
import { PASSWORD_MIN } from '@/lib/auth/password';
import type { BannerKey, FieldMessage } from '@/lib/auth/errors';
import type { FieldErrorKey } from '@/lib/auth/validation';

export type FieldError = FieldErrorKey | FieldMessage;

/** Resolves error keys and server text into the visible, translated message. */
export function useErrorText() {
  const t = useTranslations('auth.errors');
  const key = (k: string) => t(k, { min: PASSWORD_MIN });
  return {
    field: (e: FieldError | undefined) =>
      e === undefined
        ? undefined
        : typeof e === 'string'
          ? key(e)
          : 'key' in e
            ? key(e.key)
            : e.text,
    banner: (b: BannerKey | undefined) => (b ? key(b) : undefined),
  };
}

/**
 * After a failed submit (`tick` increments), focus the first invalid input in DOM order, or the
 * banner when the problem is not tied to a field.
 */
export function useFocusFirstInvalid(formRef: RefObject<HTMLFormElement | null>, tick: number) {
  useEffect(() => {
    if (tick === 0) return;
    const form = formRef.current;
    if (!form) return;
    const target =
      form.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      form.querySelector<HTMLElement>('[data-form-banner]');
    target?.focus();
  }, [tick, formRef]);
}

/** Top-level error for problems that belong to no single field. Focusable so it can receive focus on submit. */
export function FormBanner({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      tabIndex={-1}
      data-form-banner
      className="rounded-[20px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <Callout tone="danger" icon={<AlertCircle />}>
        {message}
      </Callout>
    </div>
  );
}
