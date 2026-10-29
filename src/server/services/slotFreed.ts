import type { Logger } from '@/server/http/logger';

export interface FreedSlot {
  appointmentId: string;
  serviceId: string;
  staffId: string;
  startAt: Date;
  endAt: Date;
}

/**
 * Hook called after an appointment is cancelled and its slot is free again. The waitlist task (P2.8)
 * implements the offering here; until then it deliberately does nothing.
 */
export async function onSlotFreed(
  ctx: { businessId: string; logger: Logger },
  slot: FreedSlot,
): Promise<void> {
  ctx.logger.debug({ appointmentId: slot.appointmentId }, 'slot freed (waitlist hook not wired yet)');
}
