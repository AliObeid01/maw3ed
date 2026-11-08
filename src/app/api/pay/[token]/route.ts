import { PayBody, PayParams } from '@/server/contracts/deposit';
import { ok, withRoute } from '@/server/http/withRoute';
import { payService } from '@/server/services/pay';

export const dynamic = 'force-dynamic';

// Public routes: the signed `pay` token in the path IS the credential (checked in the service, scope `pay`).
export const GET = withRoute(
  { auth: 'public', rateLimit: { policy: 'linkRead' }, params: PayParams },
  async ({ ctx, params }) => ok(await payService.get(ctx, params.token)),
);

export const POST = withRoute(
  { auth: 'public', rateLimit: { policy: 'linkAct' }, params: PayParams, body: PayBody },
  async ({ ctx, params, body }) =>
    ok(await payService.pay(ctx, params.token, undefined, body.scenario ?? 'success')),
);
