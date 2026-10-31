import { emailTokenExpiry } from '@/server/domain/emailTokens';
import { getServerEnv } from '@/server/env';
import { afterResponse } from '@/server/http/afterResponse';
import { AppError, safeError } from '@/server/http/errors';
import type { RouteContext, SessionContext } from '@/server/http/withRoute';
import { getEmailProvider } from '@/server/providers/email';
import { accountEmail } from '@/server/providers/email/accountEmails';
import { accountRepo } from '@/server/repositories/account.repo';
import { emailTokenRepo } from '@/server/repositories/emailToken.repo';
import { membershipRepo } from '@/server/repositories/membership.repo';
import { userRepo } from '@/server/repositories/user.repo';
import { newOpaqueToken, sha256Hex } from './crypto';
import { linkInvalid } from './emailVerification';
import { emailHash } from './loginGuard';
import { hashPassword, verifyPassword } from './password';
import { rateLimiter, type RateLimiter } from './rateLimit';

export interface RecoveryDeps {
  now: () => Date;
  limiter: RateLimiter;
  /** Runs the email send after the response (see afterResponse). */
  defer: (task: () => Promise<void>) => Promise<void>;
}
const defaultDeps: RecoveryDeps = {
  now: () => new Date(),
  limiter: rateLimiter,
  defer: afterResponse,
};

export const passwordRecoveryService = {
  /**
   * Public. The answer is the same for every address: a known and an unknown email get an identical 200, the
   * per-email limit counts both alike (same 429), and the work is shaped alike (a hash and one indexed
   * database call either way; the email itself goes out after the response). A failure on the known path
   * (provider down, misconfiguration) is logged and swallowed, otherwise it would reveal that the user exists.
   */
  async forgot(ctx: RouteContext, email: string, deps = defaultDeps): Promise<{ ok: true }> {
    const now = deps.now();
    const decision = await deps.limiter.consume('forgotEmail', emailHash(email));
    if (decision.limited) throw AppError.rateLimited(decision.retryAfterSec);

    const token = newOpaqueToken();
    const tokenHash = sha256Hex(token);
    const user = await userRepo.findByEmail(email);
    if (!user) {
      // Same shape of work as the known path: an indexed lookup keyed by a fresh hash.
      await emailTokenRepo.findUsable('RESET', tokenHash, now);
      ctx.logger.info('password reset requested for an unknown address');
      return { ok: true };
    }

    try {
      const provider = getEmailProvider();
      const appUrl = getServerEnv().APP_URL;
      const membership = await membershipRepo.findLatestForUser(user.id);
      const row = await emailTokenRepo.issue({
        userId: user.id,
        kind: 'RESET',
        tokenHash,
        expiresAt: emailTokenExpiry('RESET', now),
      });
      const message = accountEmail({
        kind: 'RESET',
        url: `${appUrl}/reset-password/${token}`,
        locale: membership?.business.locale,
        businessName: membership?.business.name,
      });
      await deps.defer(async () => {
        try {
          const sent = await provider.send({
            to: user.email,
            ...message,
            idempotencyKey: `reset:${row.id}`,
          });
          ctx.logger.info(
            { userId: user.id, emailTokenId: row.id, providerMessageId: sent.providerMessageId },
            'password reset email sent',
          );
        } catch (error) {
          ctx.logger.error({ userId: user.id, err: safeError(error) }, 'password reset email failed');
        }
      });
    } catch (error) {
      ctx.logger.error({ userId: user.id, err: safeError(error) }, 'password reset email failed');
    }
    return { ok: true };
  },

  /**
   * Public, single use. Checks the token before spending an argon2 hash, then one transaction claims it, sets
   * the hash, marks the email verified and deletes every session of the user. Unknown, expired, used and
   * wrong-kind tokens are the same 410. Nobody is signed in by this call.
   */
  async reset(
    ctx: RouteContext,
    input: { token: string; newPassword: string },
    deps = defaultDeps,
  ): Promise<{ ok: true }> {
    const now = deps.now();
    const tokenHash = sha256Hex(input.token);
    if (!(await emailTokenRepo.findUsable('RESET', tokenHash, now))) throw linkInvalid();
    const passwordHash = await hashPassword(input.newPassword);
    const userId = await emailTokenRepo.resetPassword(tokenHash, now, passwordHash);
    if (!userId) throw linkInvalid();
    ctx.logger.info({ userId }, 'password reset; all sessions revoked');
    return { ok: true };
  },

  /**
   * Signed-in. Guessing the current password is limited per user (5 per 15 minutes). A wrong current password
   * is a 400 on that field (a 401 would make the dashboard think the session ended). The user's OTHER sessions
   * are deleted; the current one stays.
   */
  async change(
    ctx: SessionContext,
    input: { currentPassword: string; newPassword: string },
    deps = defaultDeps,
  ): Promise<{ ok: true }> {
    const decision = await deps.limiter.consume('changePasswordUser', ctx.userId);
    if (decision.limited) throw AppError.rateLimited(decision.retryAfterSec);

    const user = await userRepo.findById(ctx.userId);
    if (!user) throw AppError.unauthenticated();
    if (!(await verifyPassword(input.currentPassword, user.passwordHash)))
      throw AppError.validation({ currentPassword: 'Current password is incorrect.' });

    const passwordHash = await hashPassword(input.newPassword);
    await accountRepo.changePassword({
      userId: user.id,
      passwordHash,
      keepSessionId: ctx.sessionId,
    });
    await deps.limiter.clear('changePasswordUser', ctx.userId);
    ctx.logger.info({ userId: user.id }, 'password changed; other sessions revoked');
    return { ok: true };
  },
};
