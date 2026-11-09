'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';

/**
 * A QR code for `url`, drawn in the browser as a data URL (no inline styles, nothing fetched). By default it is the
 * booking-link card of the Share page; the optional texts let the Claude card reuse it for the /assistant page.
 */
export function QrCard({
  url,
  name,
  title,
  body,
  alt,
  filename = 'booking-qr.png',
}: {
  url: string;
  name: string;
  title?: string;
  body?: string;
  alt?: string;
  filename?: string;
}) {
  const t = useTranslations('app.share.qr');
  const [dataUrl, setDataUrl] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import('qrcode')
      .then((QR) =>
        QR.toDataURL(url, {
          width: 352,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#0B1938', light: '#FFFFFF' },
        }),
      )
      .then((value) => {
        if (!cancelled) setDataUrl(value);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <Card size="sm" className="flex flex-wrap items-center gap-5 p-5">
      <div className="size-44 shrink-0 overflow-hidden rounded-2xl border border-line bg-white">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a generated data URL, nothing to optimise
          <img
            src={dataUrl}
            width={176}
            height={176}
            alt={alt ?? t('alt', { name })}
            className="size-full"
          />
        ) : failed ? (
          <span className="flex size-full items-center justify-center p-3 text-center text-[13px] text-muted">
            {t('failed')}
          </span>
        ) : (
          <Skeleton className="size-full rounded-none" />
        )}
      </div>
      <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-1.5">
        <h3 className="m-0 text-[17px] font-semibold">{title ?? t('title')}</h3>
        <p className="m-0 text-sm leading-[1.45] text-muted">{body ?? t('body')}</p>
        {dataUrl ? (
          <a
            href={dataUrl}
            download={filename}
            className={buttonClasses({ variant: 'secondary', className: 'mt-2 w-fit' })}
          >
            <Download size={18} aria-hidden="true" />
            {t('download')}
          </a>
        ) : null}
      </div>
    </Card>
  );
}
