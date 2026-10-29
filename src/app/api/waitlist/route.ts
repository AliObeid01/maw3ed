import { WaitlistListQuery } from '@/server/contracts/waitlist';
import { ok, withRoute } from '@/server/http/withRoute';
import { waitlistStaffService } from '@/server/services/waitlist';

export const dynamic = 'force-dynamic';

export const GET = withRoute(
  { auth: 'session', roles: ['OWNER', 'STAFF'], query: WaitlistListQuery },
  async ({ ctx, query }) => ok(await waitlistStaffService.list(ctx, query)),
);
