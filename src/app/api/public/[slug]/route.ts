import { SlugParams } from '@/server/contracts/booking';
import { ok, withRoute } from '@/server/http/withRoute';
import { publicBookingService } from '@/server/services/publicBooking';

export const dynamic = 'force-dynamic';

export const GET = withRoute(
  { auth: 'public', rateLimit: { policy: 'publicPage' }, params: SlugParams },
  async ({ ctx, params }) => ok(await publicBookingService.getBusiness(ctx, params.slug)),
);
