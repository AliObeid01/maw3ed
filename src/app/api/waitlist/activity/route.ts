import { WaitlistActivityQuery } from '@/server/contracts/waitlist';
import { ok, withRoute } from '@/server/http/withRoute';
import { waitlistStaffService } from '@/server/services/waitlist';

export const dynamic = 'force-dynamic';

export const GET = withRoute(
  { auth: 'session', roles: ['OWNER', 'STAFF'], query: WaitlistActivityQuery },
  async ({ ctx, query }) => ok(await waitlistStaffService.activity(ctx, query.limit)),
);
