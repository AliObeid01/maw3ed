import { ForgotPasswordBody } from '@/server/contracts/auth';
import { json, withRoute } from '@/server/http/withRoute';
import { passwordRecoveryService } from '@/server/services/passwordRecovery';

export const dynamic = 'force-dynamic';

export const POST = withRoute(
  { auth: 'public', rateLimit: { policy: 'forgotIp' }, body: ForgotPasswordBody },
  async ({ ctx, body }) => json(await passwordRecoveryService.forgot(ctx, body.email)),
);
