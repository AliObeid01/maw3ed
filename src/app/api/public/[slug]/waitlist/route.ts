import { SlugParams } from '@/server/contracts/booking';
import { JoinWaitlistBody } from '@/server/contracts/waitlist';
import { created, ok, withRoute } from '@/server/http/withRoute';
import { joinWaitlist } from '@/server/services/waitlist';

export const dynamic = 'force-dynamic';

export const POST = withRoute(
  {
    auth: 'public',
    rateLimit: { policy: 'waitlistJoin' },
    params: SlugParams,
    body: JoinWaitlistBody,
  },
  async ({ ctx, params, body }) => {
    const { existing, entry } = await joinWaitlist(ctx, params.slug, body);
    return existing ? ok({ entry }) : created({ entry });
  },
);
