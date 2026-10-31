import { VerifyEmailBody } from '@/server/contracts/auth';
import { json, withRoute } from '@/server/http/withRoute';
import { emailVerificationService } from '@/server/services/emailVerification';

export const dynamic = 'force-dynamic';

/** Public: the emailed token is the credential. Only this POST changes state; the page behind the link never does. */
export const POST = withRoute(
  { auth: 'public', rateLimit: { policy: 'verifyEmail' }, body: VerifyEmailBody },
  async ({ ctx, body }) => {
    await emailVerificationService.verify(ctx, body.token);
    return json({ ok: true });
  },
);
