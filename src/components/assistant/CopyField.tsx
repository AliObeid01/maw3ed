'use client';

import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useRef } from 'react';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { useCopyStatus } from './useCopyStatus';

/**
 * A read-only field holding the connector link, with a 44 px Copy button. Uses the Clipboard API and falls back to
 * selecting the text (so the person can copy by hand). The result is announced through a polite live region.
 */
export function CopyField({ value }: { value: string }) {
  const t = useTranslations('assistant.copy');
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const { state, copy } = useCopyStatus();
  const copied = state?.ok === true;

  return (
    <div className="grid gap-2.5">
      <label htmlFor={id} className="sr-only">
        {t('label')}
      </label>
      <input
        id={id}
        ref={input}
        readOnly
        dir="ltr"
        value={value}
        data-testid="connector-url"
        onFocus={(e) => e.currentTarget.select()}
        className="h-12 w-full min-w-0 rounded-input border border-line bg-canvas px-3 text-start text-[15px] text-ink"
      />
      <button
        type="button"
        data-testid="copy-connector"
        onClick={() => copy('connector', value, () => input.current?.select())}
        className={buttonClasses({ variant: copied ? 'navy' : 'primary', block: true })}
      >
        {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
        {copied ? t('copied') : t('button')}
      </button>
      <p role="status" aria-live="polite" className="sr-only" data-testid="copy-status">
        {state ? (state.ok ? t('announce') : t('failed')) : ''}
      </p>
      {state && !state.ok ? <p className="m-0 text-sm text-muted">{t('failed')}</p> : null}
    </div>
  );
}
