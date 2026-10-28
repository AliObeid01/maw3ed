'use client';

import { Check, Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { checkSlug } from '@/lib/api/auth';
import { isValidSlugFormat, previewHost } from '@/lib/auth/slug';
import { FieldShell } from '@/components/ui/Field';
import { cn } from '@/lib/cn';

export type SlugStatus =
  'idle' | 'checking' | 'available' | 'invalid' | 'reserved' | 'taken' | 'unknown';

const DEBOUNCE_MS = 400;
const noopSubscribe = () => () => {};

/** Debounced availability check. Local format problems never hit the network; a failed check is `unknown` (the server re-checks on submit). */
export function useSlugAvailability(slug: string): SlugStatus {
  const [result, setResult] = useState<{ slug: string; status: SlugStatus } | null>(null);
  const valid = isValidSlugFormat(slug);

  useEffect(() => {
    if (!slug || !valid) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      checkSlug(slug, controller.signal)
        .then((r) => setResult({ slug, status: r.available ? 'available' : (r.reason ?? 'taken') }))
        .catch(() => {
          if (!controller.signal.aborted) setResult({ slug, status: 'unknown' });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [slug, valid]);

  if (!slug) return 'idle';
  if (!valid) return 'invalid';
  // A result for an older slug is stale: show "checking" until the new one lands.
  return result && result.slug === slug ? result.status : 'checking';
}

type SlugFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  status: SlugStatus;
  /** Validation or server error; takes priority over the live status. */
  error?: string;
};

export function SlugField({
  id,
  label,
  value,
  onChange,
  placeholder,
  status,
  error,
}: SlugFieldProps) {
  const t = useTranslations('auth');
  // Configured app URL first; without one the page's own host is the best preview (browser only).
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const host = useSyncExternalStore(
    noopSubscribe,
    () => previewHost(appUrl, window.location.host),
    () => previewHost(appUrl),
  );

  const bad = status === 'invalid' || status === 'reserved' || status === 'taken';
  const statusId = `${id}-status`;
  const statusText: Record<SlugStatus, string | null> = {
    idle: null,
    checking: t('slugStatus.checking'),
    available: t('slugStatus.available'),
    invalid: t('slugStatus.invalid'),
    reserved: t('slugStatus.reserved'),
    taken: t('slugStatus.taken'),
    unknown: null,
  };
  const text = statusText[status];

  return (
    <FieldShell id={id} label={label} error={error}>
      <div
        className={cn(
          'flex h-[52px] items-center overflow-hidden rounded-input border bg-surface transition-colors duration-200 ease-out focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand',
          error ? 'border-danger' : 'border-line',
        )}
      >
        <span
          dir="ltr"
          className="flex h-full items-center border-e border-line bg-canvas px-3 text-[15px] text-muted"
        >
          {t('signup.slugPrefix')}
        </span>
        <input
          id={id}
          type="text"
          dir="ltr"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
          maxLength={40}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error ${statusId}` : statusId}
          className="h-full min-w-0 flex-1 bg-transparent px-3.5 text-start text-base text-ink outline-none placeholder:text-subtle"
        />
      </div>
      <div
        id={statusId}
        aria-live="polite"
        className="flex min-h-[38px] flex-col gap-0.5 text-[13px]"
      >
        {value ? (
          <span className="text-muted">
            {/* U+2066/U+2069 isolate the LTR address inside an RTL sentence. */}
            {t('slugStatus.preview', { url: `⁦${host}/b/${value}⁩` })}
          </span>
        ) : null}
        {text && !error ? (
          <span
            className={cn(
              'flex items-center gap-1.5 font-medium',
              bad ? (status === 'invalid' ? 'text-muted' : 'text-danger') : 'text-muted',
              status === 'available' && 'text-success',
            )}
          >
            {status === 'checking' ? (
              <Loader2
                size={14}
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />
            ) : status === 'available' ? (
              <Check size={14} aria-hidden="true" />
            ) : bad && status !== 'invalid' ? (
              <X size={14} aria-hidden="true" />
            ) : null}
            {text}
          </span>
        ) : null}
      </div>
    </FieldShell>
  );
}
