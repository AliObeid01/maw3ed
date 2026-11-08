import { LinkParams, NoQuery } from '@/server/contracts/reminders';
import { ok, withRoute } from '@/server/http/withRoute';
import { linksService } from '@/server/services/links';

export const dynamic = 'force-dynamic';

/**
 * Public and read-only. The signed `view` token in the path is verified inside the service with the outcome
 * grace (90 days after the start); a bad token is the same 404 as the other link routes. The body is exactly
 * `{ completed: boolean }`, never cached (withRoute sets `Cache-Control: no-store`).
 */
export const GET = withRoute(
  { auth: 'public', rateLimit: { policy: 'linkOutcome' }, params: LinkParams, query: NoQuery },
  async ({ params }) => ok(await linksService.outcome(params.token)),
);
