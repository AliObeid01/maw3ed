import { db } from './db';

export interface BaselineInput {
  fromDate: Date;
  toDate: Date;
  appointments: number;
  noShows: number;
  lateCancels: number;
}

export const pilotRepo = {
  getBaseline: (businessId: string) => db.pilotBaseline.findUnique({ where: { businessId } }),

  /** One baseline per business (unique businessId): the owner can correct it. */
  upsertBaseline: (businessId: string, data: BaselineInput) =>
    db.pilotBaseline.upsert({
      where: { businessId },
      create: { businessId, ...data },
      update: data,
    }),

  /**
   * Distinct appointments for which at least one H24 / H2 reminder (email or WhatsApp) was sent, and how many
   * of those the client confirmed (confirmedAt set). Feeds the confirm-rate signal.
   */
  async reminderConfirmSignal(businessId: string) {
    const rows = await db.reminderJob.findMany({
      where: { businessId, status: 'SENT', kind: { in: ['H24', 'H2'] } },
      distinct: ['appointmentId'],
      select: { appointment: { select: { confirmedAt: true } } },
    });
    return {
      remindedAppointments: rows.length,
      confirmedAfterReminder: rows.filter((r) => r.appointment.confirmedAt !== null).length,
    };
  },

  async businessCreatedAt(businessId: string): Promise<Date | null> {
    const b = await db.business.findUnique({
      where: { id: businessId },
      select: { createdAt: true },
    });
    return b?.createdAt ?? null;
  },
};
