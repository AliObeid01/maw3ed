import { CheckoutBody } from '@/server/contracts/billing';
import { OptionalIdempotencyHeaders } from '@/server/contracts/booking';
import { ok, withRoute } from '@/server/http/withRoute';
import { billingService } from '@/server/services/billing';

export const dynamic = 'force-dynamic';

export const POST = withRoute(
  { auth: 'session', roles: ['OWNER'], headers: OptionalIdempotencyHeaders, body: CheckoutBody },
  async ({ ctx, headers, body }) =>
    ok(
      await billingService.checkout(
        ctx,
        headers['idempotency-key'],
        undefined,
        body.scenario ?? 'success',
      ),
    ),
);
