'use client';

import { LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { NoShowBadge } from '@/components/app/NoShowBadge';
import type { LookupState } from '@/lib/frontdesk/lookup';
import { initials } from '@/lib/dashboard/phone';

/** Result of the phone lookup under the phone field: "Returning client: Maya Haddad" with the no-show badge. */
export function ClientCard({ state }: { state: LookupState }) {
  const t = useTranslations('app.frontDesk.client');
  // One polite live region for the whole lookup so the result is announced once it lands.
  return (
    <div role="status" aria-live="polite">
      {state.status === 'searching' ? (
        <p className="m-0 flex items-center gap-2 text-sm text-muted">
          <LoaderCircle
            size={16}
            aria-hidden="true"
            className="animate-spin motion-reduce:animate-none"
          />
          {t('searching')}
        </p>
      ) : state.status === 'found' ? (
        <div className="flex items-center gap-3 rounded-2xl bg-canvas p-3">
          <span
            aria-hidden="true"
            className="flex size-[42px] shrink-0 items-center justify-center rounded-pill bg-brand-avatar text-[15px] font-semibold text-brand"
          >
            {initials(state.client.name)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-base font-semibold">{state.client.name}</span>
            <span className="text-[13px] text-muted">
              {state.client.visits !== undefined
                ? t('returningVisits', { count: state.client.visits })
                : t('returning')}
            </span>
          </span>
          <NoShowBadge count={state.client.noShows} />
          <span className="sr-only">
            {t('returningSummary', { name: state.client.name, count: state.client.noShows })}
          </span>
        </div>
      ) : state.status === 'none' ? (
        <p className="m-0 text-sm text-muted">{t('newClient')}</p>
      ) : null}
    </div>
  );
}
