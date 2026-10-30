import type { BillingDtoT } from '@/server/contracts/billing';
import { bookableStaffLimit, PLAN_PRICE } from '@/server/domain/plan';
import { requireRole } from '@/server/http/auth';
import { AppError } from '@/server/http/errors';
import type { SessionContext } from '@/server/http/withRoute';
import { getPaymentProvider, type PaymentProvider } from '@/server/providers/payment';
import { billingRepo, PlanLimitError } from '@/server/repositories/billing.repo';
import { planLimit } from './staffService';

interface Deps {
  payments: () => PaymentProvider;
}
const defaultDeps: Deps = { payments: getPaymentProvider };

async function summary(ctx: SessionContext, provider: PaymentProvider): Promise<BillingDtoT> {
  const row = await billingRepo.summary(ctx.businessId);
  if (!row) throw AppError.notFound();
  return {
    plan: row.plan,
    limits: { bookableStaff: bookableStaffLimit(row.plan) },
    usage: { bookableStaff: row.bookableStaff },
    price: { ...PLAN_PRICE.PRO },
    testMode: provider.testMode,
  };
}

export const billingService = {
  async get(ctx: SessionContext, deps: Deps = defaultDeps) {
    requireRole(ctx, 'OWNER');
    return summary(ctx, deps.payments());
  },

  /**
   * Fake hosted test checkout, then the Payment row and the plan change in one transaction.
   * Idempotent: already on Pro, or a repeated Idempotency-Key, changes nothing.
   */
  async checkout(ctx: SessionContext, idempotencyKey?: string, deps: Deps = defaultDeps) {
    requireRole(ctx, 'OWNER');
    const provider = deps.payments();
    const current = await billingRepo.summary(ctx.businessId);
    if (!current) throw AppError.notFound();
    if (current.plan === 'PRO') return summary(ctx, provider);

    const session = await provider.createCheckout({
      businessId: ctx.businessId,
      purpose: 'PLAN',
      amount: PLAN_PRICE.PRO.amount,
      currency: PLAN_PRICE.PRO.currency,
      // Salted with the payments so far: while still FREE after a downgrade, a reused key is a new checkout.
      idempotencyKey: idempotencyKey
        ? `${idempotencyKey}:${await billingRepo.planPaymentCount(ctx.businessId)}`
        : undefined,
    });
    const status = await provider.getStatus(session.externalId);
    if (status !== 'PAID')
      throw AppError.conflict(
        'PAYMENT_NOT_COMPLETED',
        undefined,
        'The test payment did not complete.',
      );
    const outcome = await billingRepo.completeUpgrade(ctx.businessId, {
      provider: provider.name,
      externalId: session.externalId,
      amount: PLAN_PRICE.PRO.amount,
      currency: PLAN_PRICE.PRO.currency,
    });
    if (outcome === 'STALE') throw AppError.conflict('CONFLICT');
    ctx.logger.info(
      {
        businessId: ctx.businessId,
        requestId: ctx.requestId,
        outcome,
        externalId: session.externalId,
      },
      'plan checkout',
    );
    return summary(ctx, provider);
  },

  /** Back to Free when bookable usage fits; otherwise 409 PLAN_LIMIT with the numbers. */
  async downgrade(ctx: SessionContext, deps: Deps = defaultDeps) {
    requireRole(ctx, 'OWNER');
    try {
      await billingRepo.downgrade(ctx.businessId);
    } catch (error) {
      if (error instanceof PlanLimitError) throw planLimit(error);
      throw error;
    }
    return summary(ctx, deps.payments());
  },
};
