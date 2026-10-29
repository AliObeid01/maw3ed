import { OfferParams } from '@/server/contracts/waitlist';
import { ok, withRoute } from '@/server/http/withRoute';
import { offersService } from '@/server/services/waitlist';

export const dynamic = 'force-dynamic';

export const GET = withRoute(
  { auth: 'token', acts: ['claim'], params: OfferParams },
  async ({ ctx }) =>
    ok(await offersService.get({ businessId: ctx.token!.businessId }, ctx.token!.subjectId)),
);
