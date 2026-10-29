import { TimeOffParams } from '@/server/contracts/setup';
import { noContent, withRoute } from '@/server/http/withRoute';
import { timeOffService } from '@/server/services/timeOffService';

export const dynamic = 'force-dynamic';

export const DELETE = withRoute(
  { auth: 'session', roles: ['OWNER'], params: TimeOffParams },
  async ({ ctx, params }) => {
    await timeOffService.remove(ctx, params.id, params.timeOffId);
    return noContent();
  },
);
