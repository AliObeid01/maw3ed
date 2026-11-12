'use client';

import { Check, Copy } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ClaudeIcon } from '@/components/brand/ClaudeIcon';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { listGrants } from '@/lib/api/oauthGrants';
import { useResource } from '@/lib/api/useResource';
import { ConnectorUrl, useCopy } from './ConnectorUrl';

const STEPS = ['step1', 'step2', 'step3'] as const;
const PROMPTS = ['prompt1', 'prompt2', 'prompt3'] as const;
const CAN = ['can1', 'can2'] as const;
const CANNOT = ['cannot1', 'cannot2', 'cannot3'] as const;

export const MANAGE_HREF = '/app/settings#connected-apps';

/**
 * "Set up with Claude" at the top of the Setup checklist. The page renders it only while the owner connector is
 * switched on (the server passes `url`). Once a live connection exists it shrinks to a one-line "connected" row.
 */
export function OwnerConnectorCard({ url }: { url: string }) {
  const t = useTranslations('app.ownerConnector.setup');
  const grants = useResource(listGrants, 'grants');
  const { copy, copiedKey, announcer } = useCopy();

  const [retrying, setRetrying] = useState(false);
  // A Retry is over once loading ends: a later reload (with data on screen) must not swap the card for this row.
  if (retrying && !grants.loading) setRetrying(false);

  if (grants.error || (retrying && grants.loading && !grants.data)) {
    // Could not check: say so compactly instead of guessing "not connected". Stays mounted while retrying (no jump).
    return (
      <Card
        size="sm"
        as="section"
        aria-labelledby="owner-connector-title"
        data-testid="owner-connector-error"
        className="flex min-h-[76px] flex-wrap items-center gap-x-4 gap-y-1 p-4"
      >
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-input bg-brand-soft text-brand">
          <ClaudeIcon size={22} />
        </span>
        <p id="owner-connector-title" role="status" aria-live="polite" className="m-0 min-w-0 flex-[1_1_220px] text-[15px] text-muted">
          {grants.error ? t('checkFailed') : t('retrying')}
        </p>
        <button
          type="button"
          data-testid="owner-connector-retry"
          // aria-disabled, not disabled: a disabled button drops keyboard focus; clicks are ignored while a check runs.
          aria-disabled={grants.loading}
          onClick={() => {
            if (grants.loading) return;
            setRetrying(true);
            grants.reload();
          }}
          className="motion-press inline-flex min-h-11 min-w-11 items-center justify-center rounded-input px-3 text-[15px] font-semibold text-brand underline-offset-4 hover:underline aria-disabled:opacity-60"
        >
          {t('retry')}
        </button>
      </Card>
    );
  }

  if (grants.loading && !grants.data) return <Skeleton aria-hidden="true" className="h-[120px] rounded-card" />;

  if (grants.data && grants.data.length > 0) {
    return (
      <Card
        size="sm"
        as="section"
        aria-labelledby="owner-connector-title"
        data-testid="owner-connector-connected"
        className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4"
      >
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-input bg-brand-soft text-brand">
          <ClaudeIcon size={22} />
        </span>
        <div className="flex min-w-0 flex-[1_1_220px] flex-col">
          <h2 id="owner-connector-title" className="m-0 text-base font-semibold">
            {t('connectedTitle')}
          </h2>
          <p className="m-0 text-sm text-muted">{t('connectedBody')}</p>
        </div>
        <Link href={MANAGE_HREF} className="inline-flex min-h-11 items-center text-[15px] font-semibold text-brand underline-offset-4 hover:underline">
          {t('manage')}
        </Link>
      </Card>
    );
  }

  return (
    <Card
      as="section"
      aria-labelledby="owner-connector-title"
      data-testid="owner-connector"
      className="flex flex-col gap-5 p-5 md:p-6"
    >
      <div className="flex items-start gap-3.5">
        <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-input bg-brand-soft text-brand">
          <ClaudeIcon size={24} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id="owner-connector-title" className="m-0 text-lg font-semibold">
            {t('title')}
          </h2>
          <p className="m-0 text-[15px] leading-[1.5] text-muted">{t('promise')}</p>
        </div>
      </div>

      <ConnectorUrl url={url} copy={copy} copiedKey={copiedKey} />

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="owner-connector-steps" className="flex flex-col gap-2.5">
          <h3 id="owner-connector-steps" className="m-0 text-[15px] font-semibold">
            {t('stepsTitle')}
          </h3>
          <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
            {STEPS.map((id, i) => (
              <li key={id} className="flex items-start gap-3 text-[15px] leading-[1.5]">
                <span aria-hidden="true" className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-pill bg-ink text-sm font-semibold text-white">
                  {i + 1}
                </span>
                <span className="min-w-0">{t(id)}</span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="owner-connector-prompts" className="flex flex-col gap-2.5">
          <h3 id="owner-connector-prompts" className="m-0 text-[15px] font-semibold">
            {t('promptsTitle')}
          </h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {PROMPTS.map((id) => {
              const text = t(id);
              const done = copiedKey === id;
              return (
                <li key={id}>
                  <button
                    type="button"
                    dir="auto"
                    data-testid={`connector-prompt-${id}`}
                    onClick={() => copy(id, text)}
                    className="motion-press flex min-h-11 w-full items-center gap-2.5 rounded-input border border-line bg-canvas px-3.5 py-2 text-start text-[14px] leading-[1.45] text-ink transition-colors duration-200 ease-out hover:bg-brand-soft"
                  >
                    <span className="min-w-0 flex-1">{text}</span>
                    {done ? (
                      <Check size={16} aria-hidden="true" className="shrink-0 text-brand" />
                    ) : (
                      <Copy size={16} aria-hidden="true" className="shrink-0 text-muted" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <div className="grid gap-4 border-t border-divider pt-4 sm:grid-cols-2">
        <section aria-labelledby="owner-connector-can">
          <h3 id="owner-connector-can" className="m-0 mb-1.5 text-[15px] font-semibold">
            {t('canTitle')}
          </h3>
          <ul className="m-0 flex list-disc flex-col gap-1 ps-5 text-sm text-muted">
            {CAN.map((id) => (
              <li key={id}>{t(id)}</li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="owner-connector-cannot">
          <h3 id="owner-connector-cannot" className="m-0 mb-1.5 text-[15px] font-semibold">
            {t('cannotTitle')}
          </h3>
          <ul className="m-0 flex list-disc flex-col gap-1 ps-5 text-sm text-muted">
            {CANNOT.map((id) => (
              <li key={id}>{t(id)}</li>
            ))}
          </ul>
        </section>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="m-0 min-w-0 flex-[1_1_260px] text-[13px] text-muted">{t('planNote')}</p>
        <Link href={MANAGE_HREF} className="inline-flex min-h-11 items-center text-[15px] font-semibold text-brand underline-offset-4 hover:underline">
          {t('manage')}
        </Link>
      </div>
      {announcer}
    </Card>
  );
}
