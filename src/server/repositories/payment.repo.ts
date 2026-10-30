import type { Prisma } from '@/generated/prisma/client';

/**
 * A deposit hold ended without payment (cancelled by staff or client, or lapsed): its PENDING deposit
 * payment becomes EXPIRED. Call on the SAME transaction as the status change. Idempotent.
 */
export async function expirePendingDeposits(
  tx: Prisma.TransactionClient,
  businessId: string,
  appointmentIds: string[],
): Promise<number> {
  if (appointmentIds.length === 0) return 0;
  const res = await tx.payment.updateMany({
    where: {
      businessId,
      purpose: 'DEPOSIT',
      appointmentId: { in: appointmentIds },
      status: 'PENDING',
    },
    data: { status: 'EXPIRED' },
  });
  return res.count;
}
