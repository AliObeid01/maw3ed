'use client';

import { Check, Copy, ExternalLink, MessageCircle, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { assistantPageUrl, claudeShareMessage } from '@/lib/assistant/entry';
import { copyText, whatsappShareUrl } from '@/lib/setup/clipboard';
import { QrCard } from './QrCard';

/**
 * "Let clients book from Claude" on the Booking link page. The caller renders it only while the connector is switched
 * on. LISTED business: a ready-to-send message (the booking page and the /assistant page, the business name sanitized
 * and quoted), Copy, WhatsApp share and a QR code that opens /assistant. UNLISTED business: a quiet note and a link
 * to the "List my business" card above. Nothing here promises availability or a directory listing.
 */
export function ClaudeShareCard({
  name,
  slug,
  listed,
  origin,
  bookingUrl,
}: {
  name: string;
  /** The booking-page slug: stands in for a name that is empty after cleaning. */
  slug: string;
  listed: boolean;
  origin: string;
  bookingUrl: string;
}) {
  const t = useTranslations('app.share.claude');
  const toast = useToast();
  const toastCopied = t('copied');
  const copyFailed = useTranslations('app.share')('copyFailed');
  const fieldId = useId();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const assistantUrl = assistantPageUrl(origin);
  const message = useMemo(
    () =>
      claudeShareMessage((key, values) => t(key as 'message', values as never), {
        name,
        slug,
        assistantUrl,
        bookingUrl,
      }),
    [t, name, slug, assistantUrl, bookingUrl],
  );

  async function copy() {
    const ok = await copyText(message);
    if (ok) {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
      toast.show(toastCopied);
    } else {
      toast.show(copyFailed, 'error');
    }
  }

  return (
    <div className="flex flex-col gap-3.5" data-testid="claude-share">
      <Card size="sm" className="flex flex-col gap-4 p-5">
        <div className="flex items-start gap-3.5">
          <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-input bg-brand-soft text-brand">
            <Sparkles size={24} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="m-0 text-[17px] font-semibold">{t('title')}</h2>
            <p className="m-0 text-sm leading-[1.45] text-muted">{listed ? t('body') : t('unlisted')}</p>
          </div>
        </div>
        {listed ? (
          <>
            <div className="grid gap-2">
              <label htmlFor={fieldId} className="text-sm font-semibold">
                {t('messageLabel')}
              </label>
              <textarea
                id={fieldId}
                readOnly
                rows={8}
                dir="auto"
                value={message}
                data-testid="claude-share-message"
                onFocus={(e) => e.currentTarget.select()}
                className="w-full min-w-0 resize-none rounded-input border border-line bg-canvas p-3 text-start text-[15px] leading-normal text-ink"
              />
            </div>
            <div className="flex flex-wrap gap-2.5">
              <button type="button" data-testid="claude-share-copy" onClick={copy} className={buttonClasses({ variant: 'secondary', className: 'flex-1 sm:flex-none' })}>
                {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
                {copied ? t('copied') : t('copy')}
              </button>
              <a
                href={whatsappShareUrl(message)}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="claude-share-whatsapp"
                className={buttonClasses({ variant: 'whatsapp', className: 'flex-1 sm:flex-none' })}
              >
                <MessageCircle size={18} aria-hidden="true" />
                {t('whatsapp')}
                <ExternalLink size={15} aria-hidden="true" className="rtl:-scale-x-100" />
              </a>
            </div>
          </>
        ) : (
          <a
            href="#directory"
            data-testid="claude-share-list-link"
            className="inline-flex min-h-11 w-fit items-center text-[15px] font-semibold text-brand underline-offset-4 hover:underline"
          >
            {t('listLink')}
          </a>
        )}
      </Card>
      {listed ? (
        <QrCard
          url={assistantUrl}
          name={name}
          title={t('qrTitle')}
          body={t('qrBody')}
          alt={t('qrAlt')}
          filename="claude-qr.png"
        />
      ) : null}
    </div>
  );
}
