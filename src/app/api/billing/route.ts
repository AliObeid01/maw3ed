import { BillingQuery } from '@/server/contracts/billing';
import { ok, withRoute } from '@/server/http/withRoute';
import { billingService } from '@/server/services/billing';

export const dynamic = 'force-dynamic';

export const GET = withRoute(
  { auth: 'session', roles: ['OWNER'], query: BillingQuery },
  async ({ ctx }) => ok(await billingService.get(ctx)),
);
