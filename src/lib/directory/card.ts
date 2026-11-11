import type { DirectoryBusiness } from '@/lib/api/directory';
import { monogram } from '@/components/public/monogram';
import { priceLine } from '@/lib/home/categories';
import { dayLabel, formatFreeTime } from '@/lib/home/freeTimes';

/** The one business card (home and Explore) lists up to this many services and free-time chips. */
export const CARD_SERVICES_MAX = 3;
export const CARD_TIMES_MAX = 3;

export type CardModel = {
  initials: string;
  address: string | null;
  /** "12.50 USD" (cheapest active service) or null. */
  fromPrice: string | null;
  services: { name: string; price: string; durationMin: number }[];
  /** Open now / until, from the API (absent in an older cached response: show nothing). */
  open: DirectoryBusiness['openStatus'] | null;
  /** Day of the free times, by the business calendar; null when there are none. */
  day: ReturnType<typeof dayLabel> | null;
  times: { iso: string; text: string }[];
  /** The shortest service the free times are for. */
  freeService: string | null;
  /** No free time to show: the card says so quietly (never "fully booked"). */
  noFree: boolean;
};

/**
 * What one result card shows, from a directory item. Times are HH:mm in the BUSINESS zone the API returns, Latin
 * digits. `now` is injected. "Next free" only considers the shortest service, so the copy never claims a business is
 * booked out.
 */
export function cardModel(business: DirectoryBusiness, now: Date, locale: string): CardModel {
  const zone = business.timezone ?? 'Asia/Beirut';
  const isos = (business.freeTimes ?? []).slice(0, CARD_TIMES_MAX);
  return {
    initials: monogram(business.name),
    address: business.address,
    fromPrice: priceLine(business.fromPrice),
    services: (business.services ?? []).slice(0, CARD_SERVICES_MAX).map((s) => ({
      name: s.name,
      price: priceLine(s.price) ?? '',
      durationMin: s.durationMin,
    })),
    open: business.openStatus ?? null,
    day: isos[0] ? dayLabel(isos[0], zone, now, locale) : null,
    times: isos.map((iso) => ({ iso, text: formatFreeTime(iso, zone) })),
    freeService: business.nextFree?.service.name ?? null,
    noFree: isos.length === 0,
  };
}
