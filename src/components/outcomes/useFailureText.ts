'use client';

import { useTranslations } from 'next-intl';
import { useAppSession } from '@/components/app/SessionContext';
import { useErrorMessage } from '@/components/app/states';
import { ltr } from '@/components/ui/Bidi';
import type { OutcomeFailure } from '@/lib/outcomes/state';
import { formatClock } from '@/lib/time/clock';

/** Translated sentence for a failed outcome request. An "other" failure goes through the shared error text (401 signs out). */
export function useFailureText() {
  const t = useTranslations('app.outcomes.errors');
  const { timezone } = useAppSession();
  const errorMessage = useErrorMessage();
  return (failure: OutcomeFailure): string => {
    switch (failure.kind) {
      case 'notEnded':
        return t('notEnded');
      case 'notStarted':
        return t('notStarted');
      case 'tooEarly':
        // The time is the business wall clock with Latin digits, kept left-to-right inside Arabic text.
        return failure.availableAt
          ? t('tooEarly', { time: ltr(formatClock(failure.availableAt, timezone)) })
          : t('tooEarlyUnknown');
      case 'conflict':
        return t('conflict');
      case 'notFound':
        return t('notFound');
      case 'other':
        return errorMessage(failure.error);
    }
  };
}
