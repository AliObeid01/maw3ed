import type { Prisma } from '@/generated/prisma/client';

export interface NewReminderJob {
  kind: 'BOOKING' | 'H24' | 'H2';
  channel: 'EMAIL' | 'WHATSAPP';
  dueAt: Date;
}

export const reminderJobRepo = {
  /**
   * Insert a booking's reminder rows on the booking transaction. The unique key
   * (appointmentId, kind, channel) is the duplicate guard; skipDuplicates makes a repeat harmless.
   */
  async createForAppointment(
    businessId: string,
    tx: Prisma.TransactionClient,
    appointmentId: string,
    jobs: NewReminderJob[],
  ) {
    if (jobs.length === 0) return;
    await tx.reminderJob.createMany({
      data: jobs.map((j) => ({ businessId, appointmentId, ...j })),
      skipDuplicates: true,
    });
  },

  /** Cancel path: pending jobs for the appointment will never be sent. */
  async skipPending(businessId: string, tx: Prisma.TransactionClient, appointmentId: string) {
    const res = await tx.reminderJob.updateMany({
      where: { businessId, appointmentId, status: 'PENDING' },
      data: { status: 'SKIPPED' },
    });
    return res.count;
  },
};
