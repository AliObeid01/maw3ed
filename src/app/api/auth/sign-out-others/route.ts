import { ok, withRoute } from '@/server/http/withRoute';
import { authService } from '@/server/services/auth';

export const dynamic = 'force-dynamic';

export const POST = withRoute(
  { auth: 'session', rateLimit: { policy: 'signOutOthersIp' } },
  async ({ ctx }) => ok(await authService.signOutOthers(ctx)),
);
