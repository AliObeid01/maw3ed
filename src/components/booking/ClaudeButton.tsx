'use client';

import { Check, Copy, ExternalLink } from 'lucide-react';
import { ClaudeIcon } from '@/components/brand/ClaudeIcon';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useCopyStatus } from '@/components/assistant/useCopyStatus';
import { PendingLink as Link } from '@/components/public/PendingLink';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { Sheet } from '@/components/ui/Sheet';
import { CLAUDE_URL, claudeBookPrompt } from '@/lib/assistant/entry';

/**
 * "Book with Claude" on the public booking page: an outlined pill in the business header that opens the shared Sheet
 * (bottom sheet on phones, centred dialog from md). Inside: one line of explanation, a READ-ONLY prompt for THIS
 * business with a 44 px Copy button (announced through a polite live region), a link to /assistant and an "Open
 * Claude" link to claude.ai (no prefill parameter). The caller renders it only while the connector is switched on and
 * the business is listed. The business name is sanitized by `claudeBookPrompt` and only ever appears quoted.
 */
export function ClaudeButton({ name, slug }: { name: string; slug: string }) {
  const t = useTranslations('booking.claude');
  const tCopy = useTranslations('assistant.copy');
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const { state, copy } = useCopyStatus();
  const copied = state?.ok === true;
  const copyLabel = copied ? tCopy('copied') : tCopy('button');
  const failedText = tCopy('failed');
  const announce = state ? (state.ok ? tCopy('announce') : failedText) : '';

  const prompt = useMemo(
    () => claudeBookPrompt((key, values) => t(key as 'prompt', values as never), { name, slug }),
    [t, name, slug],
  );

  // Radix returns focus only to a Dialog.Trigger; ours is a plain button, so hand it back when the sheet closes.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) wasOpen.current = true;
    else if (wasOpen.current) {
      wasOpen.current = false;
      trigger.current?.focus();
    }
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-testid="claude-button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        title={t('button')}
        className={buttonClasses({ variant: 'onDark', className: 'rounded-pill max-lg:size-11 max-lg:px-0' })}
      >
        <ClaudeIcon size={18} />
        {/* Icon only below lg to stay on the pills' row; the words stay for screen readers. */}
        <span className="max-lg:sr-only">{t('button')}</span>
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={t('title')} closeLabel={t('close')}>
        <div className="grid gap-3.5" data-testid="claude-sheet">
          <p className="m-0 text-[15.5px] text-muted">{t('intro')}</p>
          <div className="grid gap-2.5">
            <label htmlFor={fieldId} className="text-sm font-semibold">
              {t('promptLabel')}
            </label>
            <textarea
              id={fieldId}
              ref={field}
              readOnly
              rows={4}
              dir="auto"
              value={prompt}
              data-testid="claude-prompt"
              onFocus={(e) => e.currentTarget.select()}
              className="w-full min-w-0 resize-none rounded-input border border-line bg-canvas p-3 text-start text-[15px] leading-normal text-ink"
            />
            <button
              type="button"
              data-testid="claude-copy"
              onClick={() => copy('prompt', prompt, () => field.current?.select())}
              className={buttonClasses({ variant: copied ? 'navy' : 'primary', block: true })}
            >
              {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
              {copyLabel}
            </button>
            <p role="status" aria-live="polite" className="sr-only" data-testid="claude-copy-status">
              {announce}
            </p>
            {state && !state.ok ? <p className="m-0 text-sm text-muted">{failedText}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-5">
            <Link
              href="/assistant"
              data-testid="claude-how"
              className="inline-flex min-h-11 items-center text-[15px] font-semibold text-brand underline-offset-4 hover:underline aria-busy:opacity-60"
            >
              {t('how')}
            </Link>
            <a
              href={CLAUDE_URL}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="claude-open"
              className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-brand underline-offset-4 hover:underline"
            >
              {t('open')}
              <ExternalLink size={15} aria-hidden="true" className="rtl:-scale-x-100" />
            </a>
          </div>
          <p className="m-0 text-sm text-muted">{t('note')}</p>
        </div>
      </Sheet>
    </>
  );
}
