import { ChangePasswordBody } from '@/server/contracts/auth';
import { json, withRoute } from '@/server/http/withRoute';
import { passwordRecoveryService } from '@/server/services/passwordRecovery';

export const dynamic = 'force-dynamic';

export const POST = withRoute(
  { auth: 'session', rateLimit: { policy: 'changePasswordIp' }, body: ChangePasswordBody },
  async ({ ctx, body }) => json(await passwordRecoveryService.change(ctx, body)),
);
