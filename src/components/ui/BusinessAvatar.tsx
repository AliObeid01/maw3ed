'use client';

import { useEffect, useRef, useState } from 'react';
import { monogram } from '@/components/public/monogram';
import { cn } from '@/lib/cn';

/**
 * Fixed boxes (no layout shift, no inline styles): the box is sized by a class, the image fills it and carries
 * explicit width / height attributes (the nominal pixel size). `hero` is 48 px, 64 px from `md`.
 */
const SIZES = {
  36: { box: 'size-9 rounded-nav text-sm', px: 36 },
  46: { box: 'size-[46px] rounded-tile text-base', px: 46 },
  52: { box: 'size-[52px] rounded-tile text-lg', px: 52 },
  64: { box: 'size-16 rounded-tile text-[22px]', px: 64 },
  hero: { box: 'size-12 rounded-tile text-lg md:size-16 md:text-[22px]', px: 64 },
} as const;

const TONES = {
  brand: 'bg-brand text-white',
  navy: 'bg-navy text-white',
  cyan: 'bg-cyan text-ink',
} as const;

export type BusinessAvatarSize = keyof typeof SIZES;
export type BusinessAvatarTone = keyof typeof TONES;

/**
 * The business logo, or the initials tile when there is none or the image cannot load (404, offline, blocked).
 * `decorative` (default): the business name is printed next to the avatar, so the image has an empty alt and the
 * initials are hidden from assistive technology. Pass `decorative={false}` where the avatar stands alone: the
 * image then has the name as alt, and the initials tile is announced as an image named after the business.
 * `priority` marks an above-the-fold avatar (eager); the rest are lazy.
 */
export function BusinessAvatar({
  name,
  logoUrl,
  size,
  tone = 'brand',
  decorative = true,
  priority = false,
  className,
}: {
  name: string;
  logoUrl?: string | null | undefined;
  size: BusinessAvatarSize;
  tone?: BusinessAvatarTone;
  decorative?: boolean;
  priority?: boolean;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const ref = useRef<HTMLImageElement>(null);
  const spec = SIZES[size];
  const showImage = !!logoUrl && failedUrl !== logoUrl;

  // An error that fired before hydration never reaches onError: check the settled state once mounted.
  useEffect(() => {
    const img = ref.current;
    if (logoUrl && img && img.complete && img.naturalWidth === 0) setFailedUrl(logoUrl);
  }, [logoUrl]);

  if (showImage) {
    return (
      <span
        className={cn(
          'inline-grid shrink-0 place-items-center overflow-hidden border border-divider bg-surface',
          spec.box,
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a 256 px WebP from our own origin; next/image would add a proxy hop */}
        <img
          ref={ref}
          src={logoUrl}
          alt={decorative ? '' : name}
          width={spec.px}
          height={spec.px}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onError={() => setFailedUrl(logoUrl)}
          className="block size-full object-cover"
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden={decorative ? true : undefined}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      className={cn(
        'inline-grid shrink-0 place-items-center font-bold',
        spec.box,
        TONES[tone],
        className,
      )}
    >
      {monogram(name)}
    </span>
  );
}
