import { ClaimBody, OfferParams } from '@/server/contracts/waitlist';
import { created, ok, withRoute } from '@/server/http/withRoute';
import { offersService } from '@/server/services/waitlist';

export const dynamic = 'force-dynamic';

export const POST = withRoute(
  {
    auth: 'token',
    rateLimit: { policy: 'linkAct' },
    acts: ['claim'],
    params: OfferParams,
    body: ClaimBody,
  },
  async ({ ctx }) => {
    const token = ctx.token!;
    const { replay, ...result } = await offersService.claim(
      { businessId: token.businessId, requestId: ctx.requestId, logger: ctx.logger },
      token.subjectId,
    );
    return replay ? ok(result) : created(result);
  },
);
