'use client';

import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { cn } from '@/lib/cn';
import { copyText } from '@/lib/setup/clipboard';

/**
 * Copy-to-clipboard with a graceful fallback (lib/setup/clipboard) and a polite live region that says "Copied"
 * to screen readers. `announcement` goes inside the caller's tree via `<CopyAnnouncer />`.
 */
export function useCopy() {
  const t = useTranslations('app.ownerConnector.setup');
  const [message, setMessage] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy(key: string, text: string) {
    const ok = await copyText(text);
    clearTimeout(timer.current);
    setMessage(ok ? t('copied') : t('copyFailed'));
    setCopiedKey(ok ? key : null);
    timer.current = setTimeout(() => {
      setCopiedKey(null);
      setMessage('');
    }, 2500);
  }

  const announcer = (
    <span role="status" aria-live="polite" className="sr-only" data-testid="connector-copy-status">
      {message}
    </span>
  );
  return { copy, copiedKey, announcer };
}

/** The connector link in a read-only field with a 44 px Copy button. Selects on focus, so it is copyable by hand. */
export function ConnectorUrl({
  url,
  copy,
  copiedKey,
  className,
}: {
  url: string;
  copy: (key: string, text: string) => void;
  copiedKey: string | null;
  className?: string;
}) {
  const t = useTranslations('app.ownerConnector.setup');
  const id = useId();
  const done = copiedKey === 'url';
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-semibold">
        {t('urlLabel')}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={id}
          readOnly
          dir="ltr"
          value={url}
          data-testid="connector-url"
          onFocus={(e) => e.currentTarget.select()}
          className="h-11 min-w-0 flex-1 rounded-input border border-line bg-canvas px-3 text-start text-[15px] text-ink"
        />
        <button
          type="button"
          data-testid="connector-copy"
          onClick={() => copy('url', url)}
          className={buttonClasses({ variant: 'secondary', className: 'sm:w-auto' })}
        >
          {done ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
          {done ? t('copied') : t('copy')}
        </button>
      </div>
    </div>
  );
}
