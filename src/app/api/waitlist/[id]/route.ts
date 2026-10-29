import { WaitlistEntryParams } from '@/server/contracts/waitlist';
import { noContent, withRoute } from '@/server/http/withRoute';
import { waitlistStaffService } from '@/server/services/waitlist';

export const dynamic = 'force-dynamic';

export const DELETE = withRoute(
  { auth: 'session', roles: ['OWNER', 'STAFF'], params: WaitlistEntryParams },
  async ({ ctx, params }) => {
    await waitlistStaffService.cancel(ctx, params.id);
    return noContent();
  },
);
