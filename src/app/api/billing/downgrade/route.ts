import { DowngradeBody } from '@/server/contracts/billing';
import { ok, withRoute } from '@/server/http/withRoute';
import { billingService } from '@/server/services/billing';

export const dynamic = 'force-dynamic';

export const POST = withRoute(
  { auth: 'session', roles: ['OWNER'], body: DowngradeBody },
  async ({ ctx }) => ok(await billingService.downgrade(ctx)),
);
