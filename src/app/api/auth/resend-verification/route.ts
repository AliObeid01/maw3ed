import { json, withRoute } from '@/server/http/withRoute';
import { emailVerificationService } from '@/server/services/emailVerification';

export const dynamic = 'force-dynamic';

export const POST = withRoute(
  { auth: 'session', rateLimit: { policy: 'resendVerificationIp' } },
  async ({ ctx }) => json(await emailVerificationService.resend(ctx)),
);
