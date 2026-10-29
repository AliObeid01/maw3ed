import { SlotsQuery, SlugParams } from '@/server/contracts/booking';
import { ok, withRoute } from '@/server/http/withRoute';
import { publicBookingService } from '@/server/services/publicBooking';

export const dynamic = 'force-dynamic';

// Never cached: a slot disappears the moment it is booked.
export const GET = withRoute(
  { auth: 'public', rateLimit: { policy: 'slots' }, params: SlugParams, query: SlotsQuery },
  async ({ ctx, params, query }) => ok(await publicBookingService.slots(ctx, params.slug, query)),
);
