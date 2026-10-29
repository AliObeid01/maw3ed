'use client';

import { useTranslations } from 'next-intl';
import { useErrorMessage } from '@/components/app/states';
import type { OutcomeFailure } from '@/lib/outcomes/state';

/** Translated sentence for a failed outcome request. An "other" failure goes through the shared error text (401 signs out). */
export function useFailureText() {
  const t = useTranslations('app.outcomes.errors');
  const errorMessage = useErrorMessage();
  return (failure: OutcomeFailure): string => {
    switch (failure.kind) {
      case 'notEnded':
        return t('notEnded');
      case 'notStarted':
        return t('notStarted');
      case 'conflict':
        return t('conflict');
      case 'notFound':
        return t('notFound');
      case 'other':
        return errorMessage(failure.error);
    }
  };
}
