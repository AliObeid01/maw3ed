'use client';

import { Check, Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { FieldShell } from '@/components/ui/Field';
import { checkSlug } from '@/lib/api/auth';
import { SLUG_MAX, SLUG_MIN, previewHost } from '@/lib/auth/slug';
import {
  deriveSlugStatus,
  needsServerCheck,
  scheduleSlugCheck,
  type SlugStatus,
} from '@/lib/auth/slugAvailability';
import { cn } from '@/lib/cn';

export type { SlugStatus };

const noopSubscribe = () => () => {};
/** "Checking" is only shown (and announced) when the server is slow. */
const CHECKING_VISIBLE_AFTER_MS = 600;

export function useSlugAvailability(slug: string): SlugStatus {
  const [result, setResult] = useState<{ slug: string; status: SlugStatus } | null>(null);
  const shouldCheck = needsServerCheck(slug);

  useEffect(() => {
    if (!shouldCheck) return;
    return scheduleSlugCheck(slug, checkSlug, (s, status) => setResult({ slug: s, status }));
  }, [slug, shouldCheck]);

  return deriveSlugStatus(slug, result);
}

/** True once `active` has been continuously true for `ms`. */
function useAfterDelay(active: boolean, ms: number) {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setElapsed(true), ms);
    return () => {
      clearTimeout(timer);
      setElapsed(false);
    };
  }, [active, ms]);
  return active && elapsed;
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
  readOnly?: boolean;
};

export function SlugField({
  id,
  label,
  value,
  onChange,
  placeholder,
  status,
  error,
  readOnly,
}: SlugFieldProps) {
  const t = useTranslations('auth');
  // Configured app URL first; without one the page's own host is the best preview (browser only).
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const host = useSyncExternalStore(
    noopSubscribe,
    () => previewHost(appUrl, window.location.host),
    () => previewHost(appUrl),
  );
  const showChecking = useAfterDelay(status === 'checking', CHECKING_VISIBLE_AFTER_MS);

  const bad = status === 'reserved' || status === 'taken';
  const statusId = `${id}-status`;
  const bounds = { slugMin: SLUG_MIN, slugMax: SLUG_MAX };
  const text =
    status === 'checking'
      ? showChecking
        ? t('slugStatus.checking')
        : null
      : status === 'available'
        ? t('slugStatus.available')
        : status === 'invalid'
          ? t('slugStatus.invalid', bounds)
          : status === 'reserved'
            ? t('slugStatus.reserved')
            : status === 'taken'
              ? t('slugStatus.taken')
              : null;

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
          name="slug"
          type="text"
          dir="ltr"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={readOnly}
          placeholder={placeholder}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
          maxLength={SLUG_MAX}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error ${statusId}` : statusId}
          className="h-full min-w-0 flex-1 bg-transparent px-3.5 text-start text-base text-ink outline-none placeholder:text-subtle"
        />
      </div>
      {/* The preview changes on every keystroke, so it stays OUT of the live region. */}
      <p className="m-0 min-h-[19px] text-[13px] text-muted">
        {value
          ? // U+2066/U+2069 isolate the LTR address inside an RTL sentence.
            t('slugStatus.preview', { url: `⁦${host}/b/${value}⁩` })
          : null}
      </p>
      {/* Only the status text is announced (polite), and "checking" only if it is slow. */}
      <div id={statusId} aria-live="polite" className={cn('text-[13px]', status !== 'idle' && 'min-h-[19px]')}>
        {text && !error ? (
          <span
            className={cn(
              'flex items-center gap-1.5 font-medium',
              bad ? 'text-danger' : status === 'available' ? 'text-success' : 'text-muted',
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
            ) : bad ? (
              <X size={14} aria-hidden="true" />
            ) : null}
            {text}
          </span>
        ) : null}
      </div>
    </FieldShell>
  );
}
