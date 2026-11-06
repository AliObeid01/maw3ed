import { emailTokenExpiry } from '@/server/domain/emailTokens';
import { getServerEnv } from '@/server/env';
import { afterResponse } from '@/server/http/afterResponse';
import { AppError, safeError } from '@/server/http/errors';
import type { Logger } from '@/server/http/logger';
import type { RouteContext, SessionContext } from '@/server/http/withRoute';
import { getEmailProvider } from '@/server/providers/email';
import { accountEmail } from '@/server/providers/email/accountEmails';
import { businessRepo } from '@/server/repositories/business.repo';
import { emailTokenRepo } from '@/server/repositories/emailToken.repo';
import { userRepo } from '@/server/repositories/user.repo';
import { newOpaqueToken, sha256Hex } from './crypto';
import { rateLimiter, type RateLimiter } from './rateLimit';

export interface VerificationDeps {
  now: () => Date;
  limiter: RateLimiter;
}
const defaultDeps: VerificationDeps = { now: () => new Date(), limiter: rateLimiter };

/**
 * Create a VERIFY token (older unused ones die) and e-mail the link. The provider and APP_URL are resolved
 * BEFORE any row is written, so a misconfiguration leaves nothing behind. The token only ever exists in the
 * message: it is never logged and only its sha256 is stored. Throws when the email cannot be sent.
 */
export async function sendVerificationEmail(
  logger: Logger,
  user: { id: string; email: string },
  business: { name: string; locale: string },
  now: Date,
): Promise<void> {
  const provider = getEmailProvider();
  const appUrl = getServerEnv().APP_URL;
  const token = newOpaqueToken();
  const row = await emailTokenRepo.issue({
    userId: user.id,
    kind: 'VERIFY',
    tokenHash: sha256Hex(token),
    expiresAt: emailTokenExpiry('VERIFY', now),
  });
  const message = accountEmail({
    kind: 'VERIFY',
    url: `${appUrl}/verify-email/${token}`,
    locale: business.locale,
    businessName: business.name,
  });
  const sent = await provider.send({
    to: user.email,
    ...message,
    idempotencyKey: `verify:${row.id}`,
  });
  logger.info(
    { userId: user.id, emailTokenId: row.id, providerMessageId: sent.providerMessageId },
    'verification email sent',
  );
}

export const emailVerificationService = {
  /**
   * Signup: never fails the signup and never delays it: the token and the email are handled after the
   * response. If the email cannot be sent the owner can use "Resend email"; the failure is logged (without
   * recipient or token).
   */
  async sendForNewAccount(
    ctx: RouteContext,
    user: { id: string; email: string },
    business: { id: string; name: string; locale: string },
    now: Date,
  ): Promise<void> {
    await afterResponse(async () => {
      try {
        await sendVerificationEmail(ctx.logger, user, business, now);
      } catch (error) {
        ctx.logger.error(
          { userId: user.id, businessId: business.id, err: safeError(error) },
          'verification email failed',
        );
      }
    });
  },

  /**
   * Public. The token is the credential; unknown, expired, used and wrong-kind tokens are all the same 410
   * so a caller learns nothing about which tokens exist. Single use is decided by one conditional update.
   */
  async verify(ctx: RouteContext, token: string, deps = defaultDeps): Promise<void> {
    const userId = await emailTokenRepo.verifyEmail(sha256Hex(token), deps.now());
    if (!userId) throw linkInvalid();
    ctx.logger.info({ userId }, 'email verified');
  },

  /** Signed-in user: send a fresh link. Already verified -> nothing is sent. Limited per user (and per IP at the route). */
  async resend(
    ctx: SessionContext,
    deps = defaultDeps,
  ): Promise<{ ok: true; alreadyVerified: boolean }> {
    const user = await userRepo.findById(ctx.userId);
    if (!user) throw AppError.unauthenticated();
    // Phone-only accounts (staff logins) have no address to verify: a clean refusal, nothing is sent.
    if (!user.email)
      throw AppError.conflict('NO_EMAIL', undefined, 'This account has no email address.');
    if (user.emailVerifiedAt) return { ok: true, alreadyVerified: true };

    const decision = await deps.limiter.consume('resendVerificationUser', user.id);
    if (decision.limited) throw AppError.rateLimited(decision.retryAfterSec);

    const business = await businessRepo.findById(ctx.businessId);
    if (!business) throw AppError.notFound();
    try {
      await sendVerificationEmail(ctx.logger, { id: user.id, email: user.email }, business, deps.now());
    } catch (error) {
      ctx.logger.error({ userId: user.id, err: safeError(error) }, 'verification email failed');
      throw AppError.unavailable('The email could not be sent. Try again.');
    }
    return { ok: true, alreadyVerified: false };
  },

  /** Gate for inviting staff and listing in the directory (soft verification). */
  async assertVerified(userId: string): Promise<void> {
    const user = await userRepo.findById(userId);
    if (!user) throw AppError.unauthenticated();
    if (!user.emailVerifiedAt) throw AppError.emailNotVerified();
  },
};

/** Same answer for unknown, expired, used and wrong-kind tokens. */
export const linkInvalid = () =>
  AppError.gone('LINK_INVALID', 'This link is not valid or has expired.');
