import type { Logger } from '@/server/http/logger';
import { onSlotFreedOffer } from './waitlist';

export interface FreedSlot {
  appointmentId: string;
  serviceId: string;
  staffId: string;
  startAt: Date;
  endAt: Date;
}

/**
 * Hook called after an appointment is cancelled and its slot is free again: offers the slot to the
 * waitlist (FR-19). It never throws, because the cancel is already committed; failures are logged.
 */
export async function onSlotFreed(
  ctx: { businessId: string; logger: Logger },
  slot: FreedSlot,
): Promise<void> {
  await onSlotFreedOffer(ctx, slot.appointmentId);
}
