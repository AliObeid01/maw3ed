'use client';

import { AlertCircle } from 'lucide-react';
import { useEffect, type ReactNode, type RefObject } from 'react';
import { Callout } from '@/components/ui/Callout';
import type { FieldMessage } from '@/lib/auth/errors';
import type { FieldErrorKey } from '@/lib/auth/validation';

export type FieldError = FieldErrorKey | FieldMessage;

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
      className="rounded-card-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <Callout tone="danger" icon={<AlertCircle />}>
        {message}
        {action ? <div className="mt-3">{action}</div> : null}
      </Callout>
    </div>
  );
}
