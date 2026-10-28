'use client';

import { AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, type ReactNode, type RefObject } from 'react';
import { Callout } from '@/components/ui/Callout';
import { PASSWORD_MAX, PASSWORD_MIN } from '@/lib/auth/password';
import { SLUG_MAX, SLUG_MIN } from '@/lib/auth/slug';
import type { BannerKey, FieldMessage } from '@/lib/auth/errors';
import type { FieldErrorKey } from '@/lib/auth/validation';

export type FieldError = FieldErrorKey | FieldMessage;

/** Resolves error keys into the visible, translated message (server text is never shown raw). */
export function useErrorText() {
  const t = useTranslations('auth.errors');
  const key = (k: string) =>
    t(k, { min: PASSWORD_MIN, max: PASSWORD_MAX, slugMin: SLUG_MIN, slugMax: SLUG_MAX });
  return {
    field: (e: FieldError | undefined) =>
      e === undefined ? undefined : key(typeof e === 'string' ? e : e.key),
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
export function FormBanner({ message, action }: { message?: string; action?: ReactNode }) {
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
        {action ? <div className="mt-3">{action}</div> : null}
      </Callout>
    </div>
  );
}
