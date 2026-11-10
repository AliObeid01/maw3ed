'use client';

import { BookmarkPlus, Check } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  useMounted,
  useSavedBookings,
  useStorageAvailability,
} from '@/components/myBookings/useSavedBookings';
import { Button } from '@/components/ui/Button';
import type { LinkView } from '@/lib/api/links';
import { canSaveLink, entryFromLink } from '@/lib/myBookings/fromLink';
import { myBookings } from '@/lib/myBookings/storage';

/**
 * "Save to My bookings on this device" under the booking summary of the link page. A booking made through Claude
 * or by phone never passes through the booking flow, so this is how it reaches My bookings. Saves through the
 * existing store (validated, no name, phone or email). Nothing renders on the server, for a cancelled or past
 * booking, for a confirm or cancel link, or when the browser blocks storage.
 */
export function SaveToDevice({ link, token }: { link: LinkView; token: string }) {
  const t = useTranslations('link.save');
  const mounted = useMounted();
  const list = useSavedBookings();
  const availability = useStorageAvailability();
  if (!mounted || availability === 'blocked') return null;

  const now = new Date();
  if (!canSaveLink(link, now)) return null;
  const entry = entryFromLink(link, token, now);
  if (!entry) return null;

  const alreadySaved = list.some((e) => e.token === token);
  if (alreadySaved) {
    return (
      <p
        className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted"
        data-testid="link-saved"
      >
        <span className="inline-flex items-center gap-1.5">
          <Check size={16} aria-hidden="true" className="text-success" />
          {t('done')}
        </span>
        <Link href="/my-bookings" className="inline-flex min-h-11 items-center font-semibold text-brand">
          {t('view')}
        </Link>
      </p>
    );
  }
  return (
    <Button
      variant="secondary"
      size="lg"
      className="max-sm:w-full sm:self-start"
      onClick={() => myBookings.save(entry)}
    >
      <BookmarkPlus size={18} aria-hidden="true" />
      {t('button')}
    </Button>
  );
}
