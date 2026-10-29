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
   * Confirm-rate inputs, one SQL aggregate. Population: appointments that already started (startAt < now),
   * not CANCELLED / LATE_CANCEL / PENDING_PAYMENT, with at least one H24 or H2 reminder SENT (email or
   * WhatsApp). `confirmed` = those with confirmedAt set. The BOOKING email also carries the confirm link, so
   * a confirmation can pre-date the reminder: the rate says "of the reminded appointments, how many were
   * confirmed", not "confirmed because of the reminder".
   */
  async reminderConfirmSignal(businessId: string, now: Date) {
    const rows = await db.$queryRaw<{ reminded: number; confirmed: number }[]>`
      SELECT count(*)::int AS reminded,
             (count(*) FILTER (WHERE a."confirmedAt" IS NOT NULL))::int AS confirmed
      FROM "Appointment" a
      WHERE a."businessId" = ${businessId}
        AND a."startAt" < ${now}
        AND a."status" NOT IN ('CANCELLED', 'LATE_CANCEL', 'PENDING_PAYMENT')
        AND EXISTS (
          SELECT 1 FROM "ReminderJob" r
          WHERE r."appointmentId" = a."id" AND r."businessId" = a."businessId"
            AND r."status" = 'SENT' AND r."kind" IN ('H24', 'H2'))`;
    return {
      remindedAppointments: rows[0]?.reminded ?? 0,
      confirmedAfterReminder: rows[0]?.confirmed ?? 0,
    };
  },

  /**
   * Waitlist refill signal from WaitlistOffer rows created in [since, until]: freed slots that were offered
   * (distinct freedFromAppointmentId) and those whose offer was CLAIMED (a client rebooked the slot).
   */
  async waitlistSignal(businessId: string, since: Date, until: Date) {
    const rows = await db.$queryRaw<{ offered: number; refilled: number }[]>`
      SELECT count(DISTINCT o."freedFromAppointmentId")::int AS offered,
             (count(DISTINCT o."freedFromAppointmentId") FILTER (WHERE o."status" = 'CLAIMED'))::int AS refilled
      FROM "WaitlistOffer" o
      WHERE o."businessId" = ${businessId}
        AND o."createdAt" >= ${since} AND o."createdAt" <= ${until}`;
    return { slotsOffered: rows[0]?.offered ?? 0, refills: rows[0]?.refilled ?? 0 };
  },

  async businessCreatedAt(businessId: string): Promise<Date | null> {
    const b = await db.business.findUnique({
      where: { id: businessId },
      select: { createdAt: true },
    });
    return b?.createdAt ?? null;
  },
};
