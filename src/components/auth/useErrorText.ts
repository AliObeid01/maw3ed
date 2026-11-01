'use client';

import { useTranslations } from 'next-intl';
import { PASSWORD_MAX, PASSWORD_MIN } from '@/lib/auth/password';
import { SLUG_MAX, SLUG_MIN } from '@/lib/auth/slug';
import type { BannerKey, ServerFieldKey } from '@/lib/auth/errors';
import type { FieldErrorKey } from '@/lib/auth/validation';
import type { FieldError } from './formKit';

/**
 * Resolves error keys into the visible, translated message (server text is never shown raw).
 * Kept out of `formKit` so the public booking pages, which only use `FormBanner`, do not pull in `auth.errors`.
 */
export function useErrorText() {
  const t = useTranslations('auth.errors');
  const key = (k: BannerKey | ServerFieldKey | FieldErrorKey) =>
    t(k, { min: PASSWORD_MIN, max: PASSWORD_MAX, slugMin: SLUG_MIN, slugMax: SLUG_MAX });
  return {
    field: (e: FieldError | undefined) =>
      e === undefined ? undefined : key(typeof e === 'string' ? e : e.key),
    banner: (b: BannerKey | undefined) => (b ? key(b) : undefined),
  };
}
