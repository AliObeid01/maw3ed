import { ResetPasswordBody } from '@/server/contracts/auth';
import { json, withRoute } from '@/server/http/withRoute';
import { passwordRecoveryService } from '@/server/services/passwordRecovery';

export const dynamic = 'force-dynamic';

export const POST = withRoute(
  { auth: 'public', rateLimit: { policy: 'resetPasswordIp' }, body: ResetPasswordBody },
  async ({ ctx, body }) => json(await passwordRecoveryService.reset(ctx, body)),
);
