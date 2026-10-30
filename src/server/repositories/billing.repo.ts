import type { Prisma } from '@/generated/prisma/client';
import {
  bookableStaffLimit,
  canAddBookableStaff,
  fitsPlan,
  type PlanName,
} from '@/server/domain/plan';
import { db } from './db';

type Tx = Prisma.TransactionClient;

/** The plan does not allow this many bookable staff. Carries the numbers for the 409 payload. */
export class PlanLimitError extends Error {
  constructor(
    readonly limit: number,
    readonly current: number,
  ) {
    super('Plan limit reached');
  }
}

/** The business was not found (cannot happen for a live session; kept as a clear signal). */
export class BusinessNotFoundError extends Error {}

/** Row-lock the business and return its plan. Serialises plan changes with limit-checked staff writes. */
async function lockPlan(tx: Tx, businessId: string): Promise<PlanName> {
  const rows = await tx.$queryRaw<{ plan: PlanName }[]>`
    SELECT plan FROM "Business" WHERE id = ${businessId} FOR UPDATE`;
  if (rows.length !== 1) throw new BusinessNotFoundError();
  return rows[0]!.plan;
}

const countBookable = (tx: Tx, businessId: string, excludeStaffId?: string) =>
  tx.staffMember.count({
    where: {
      businessId,
      active: true,
      bookable: true,
      ...(excludeStaffId ? { id: { not: excludeStaffId } } : {}),
    },
  });

/**
 * Call inside the transaction that is about to add (or re-enable) one active bookable staff member.
 * Locks the business row, then throws PlanLimitError when the plan has no room. Existing staff are never
 * touched, so data that is already over the limit stays as it is (grandfathered).
 */
export async function assertRoomForBookable(
  tx: Tx,
  businessId: string,
  excludeStaffId?: string,
): Promise<void> {
  const plan = await lockPlan(tx, businessId);
  const check = canAddBookableStaff(plan, await countBookable(tx, businessId, excludeStaffId));
  if (!check.ok) throw new PlanLimitError(check.limit, check.current);
}

export type UpgradeOutcome = 'UPGRADED' | 'ALREADY_PRO' | 'REPLAY';

export const billingRepo = {
  summary: async (businessId: string) => {
    const [business, bookable] = await Promise.all([
      db.business.findUnique({ where: { id: businessId }, select: { plan: true } }),
      db.staffMember.count({ where: { businessId, active: true, bookable: true } }),
    ]);
    return business ? { plan: business.plan as PlanName, bookableStaff: bookable } : null;
  },

  /**
   * Record the paid plan payment and set the plan in ONE transaction, under the business row lock, so two
   * concurrent calls cannot both upgrade. A payment already recorded for this provider id is a replay.
   */
  completeUpgrade: (
    businessId: string,
    payment: { provider: string; externalId: string; amount: number; currency: string },
  ) =>
    db.$transaction(async (tx): Promise<UpgradeOutcome> => {
      const plan = await lockPlan(tx, businessId);
      const existing = await tx.payment.findUnique({
        where: {
          provider_externalId: { provider: payment.provider, externalId: payment.externalId },
        },
        select: { businessId: true },
      });
      if (existing) return 'REPLAY';
      if (plan === 'PRO') return 'ALREADY_PRO';
      await tx.payment.create({
        data: { businessId, purpose: 'PLAN', status: 'PAID', ...payment },
      });
      await tx.business.update({ where: { id: businessId }, data: { plan: 'PRO' } });
      return 'UPGRADED';
    }),

  /** Back to FREE, only when current bookable usage fits. Throws PlanLimitError (limit, current) otherwise. */
  downgrade: (businessId: string) =>
    db.$transaction(async (tx): Promise<'DOWNGRADED' | 'ALREADY_FREE'> => {
      const plan = await lockPlan(tx, businessId);
      if (plan === 'FREE') return 'ALREADY_FREE';
      const current = await countBookable(tx, businessId);
      if (!fitsPlan('FREE', current))
        throw new PlanLimitError(bookableStaffLimit('FREE') ?? 1, current);
      await tx.business.update({ where: { id: businessId }, data: { plan: 'FREE' } });
      return 'DOWNGRADED';
    }),
};
