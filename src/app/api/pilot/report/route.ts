import { ReportQuery } from '@/server/contracts/outcomes';
import { ok, withRoute } from '@/server/http/withRoute';
import { pilotService } from '@/server/services/pilot';

export const dynamic = 'force-dynamic';

export const GET = withRoute(
  { auth: 'session', roles: ['OWNER'], query: ReportQuery },
  async ({ ctx, query }) => ok(await pilotService.report(ctx, query.weeks)),
);
