'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PROMPT_KEYS } from '@/lib/assistant';
import { cn } from '@/lib/cn';
import { useCopyStatus } from './useCopyStatus';

/** Three example prompts. Tapping one copies its text (to paste into Claude); the result is announced politely. */
export function PromptChips() {
  const t = useTranslations('assistant');
  const { state, copy } = useCopyStatus();

  return (
    <div className="grid gap-2.5">
      <ul aria-label={t('prompts.label')} className="m-0 grid list-none gap-2.5 p-0" data-testid="prompt-chips">
        {PROMPT_KEYS.map((key) => {
          const text = t(`prompts.${key}`);
          const copied = state?.key === key && state.ok;
          return (
            <li key={key}>
              <button
                type="button"
                data-testid={`prompt-${key}`}
                onClick={() => copy(key, text)}
                className={cn(
                  'flex min-h-11 w-full items-center justify-between gap-3 rounded-btn border px-3.5 py-2 text-start text-[15px] leading-snug transition-colors duration-200 ease-out motion-reduce:transition-none',
                  copied ? 'border-success bg-success-soft text-success' : 'border-line bg-surface text-ink hover:bg-canvas',
                )}
              >
                <span>{text}</span>
                {copied ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold">
                    <Check size={16} aria-hidden="true" />
                    {t('copy.copied')}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <p role="status" aria-live="polite" className="sr-only" data-testid="prompt-status">
        {state ? (state.ok ? t('copy.announce') : t('copy.failed')) : ''}
      </p>
    </div>
  );
}
