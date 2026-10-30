import { ClaimBody, OfferParams } from '@/server/contracts/waitlist';
import { ok, withRoute } from '@/server/http/withRoute';
import { offersService } from '@/server/services/waitlist';

export const dynamic = 'force-dynamic';

export const POST = withRoute(
  {
    auth: 'token',
    rateLimit: { policy: 'linkAct' },
    acts: ['leave'],
    params: OfferParams,
    body: ClaimBody,
  },
  async ({ ctx }) =>
    ok(
      await offersService.leave(
        { businessId: ctx.token!.businessId, logger: ctx.logger },
        ctx.token!.subjectId,
      ),
    ),
);
