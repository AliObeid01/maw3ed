import type { LinkView } from '@/lib/api/links';
import { entryFromBooking, type SavedBooking } from './storage';

/** Statuses of a booking that is over or no longer happening. */
const CLOSED = new Set(['CANCELLED', 'LATE_CANCEL', 'ATTENDED', 'NO_SHOW']);

/**
 * May the link page offer "Save to My bookings on this device"? Only for an upcoming booking that is still open,
 * opened with a plain `view` link (the token stored is the one My bookings later uses to read, confirm and cancel,
 * so a confirm-only or cancel-only token must not be stored in its place).
 */
export function canSaveLink(link: LinkView, now: Date): boolean {
  if (link.act !== 'view') return false;
  if (CLOSED.has(link.appointment.status)) return false;
  return Date.parse(link.appointment.startAt) > now.getTime();
}

/**
 * The entry to store for a booking opened through its link, built by the SAME function as a fresh booking
 * (`entryFromBooking`): business, service, staff, times and reference only, never the client's name, phone or
 * email (the link has none). Undefined when the token or slug would not survive the storage validator.
 */
export function entryFromLink(link: LinkView, token: string, now: Date): SavedBooking | undefined {
  if (link.act !== 'view') return undefined;
  const { appointment, business } = link;
  return entryFromBooking(
    {
      appointment: {
        reference: appointment.reference,
        startAt: appointment.startAt,
        endAt: appointment.endAt,
        service: { name: appointment.service.name },
        staff: { displayName: appointment.staff.displayName },
      },
      // entryFromBooking reads the token from a manage link; build one the way the app does.
      links: { manage: `/l/${encodeURIComponent(token)}` },
    },
    { slug: business.slug, name: business.name, timezone: business.timezone },
    now,
  );
}
