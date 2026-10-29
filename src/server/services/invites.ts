import { requireRole } from '@/server/http/auth';
import { AppError, fromDbError } from '@/server/http/errors';
import type { RouteContext, SessionContext } from '@/server/http/withRoute';
import { getEmailProvider, isFakeEmail } from '@/server/providers/email';
import { inviteEmail } from '@/server/providers/email/inviteTemplate';
import { businessRepo } from '@/server/repositories/business.repo';
import { InviteGoneError, inviteRepo } from '@/server/repositories/invite.repo';
import { membershipRepo } from '@/server/repositories/membership.repo';
import { userRepo } from '@/server/repositories/user.repo';
import { toSessionInfo, type AuthDeps, type SignedIn } from './auth';
import { newOpaqueToken, sha256Hex } from './crypto';
import { loginThrottle } from './loginThrottle';
import { hashPassword, verifyPassword } from './password';
import { sessionService } from './session';

export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
const defaultDeps: AuthDeps = { now: () => new Date(), throttle: loginThrottle };

const notFound = () => AppError.notFound('This invitation is not valid.');

export const invitesService = {
  /** OWNER only. Replaces any open invite for the same email. Only the token hash is stored. */
  async create(ctx: SessionContext, input: { email: string; role: 'STAFF' }, deps = defaultDeps) {
    requireRole(ctx, 'OWNER');
    const now = deps.now();
    // Resolve the provider first: a misconfiguration (e.g. fake in production) fails before any row is written.
    const provider = getEmailProvider();
    if (await membershipRepo.hasMemberWithEmail(ctx.businessId, input.email))
      throw AppError.conflict('ALREADY_MEMBER', undefined, 'That person is already on your team.');
    const business = await businessRepo.findById(ctx.businessId);
    if (!business) throw AppError.notFound();

    const token = newOpaqueToken();
    const invite = await inviteRepo.replaceOpen(ctx.businessId, {
      email: input.email,
      role: input.role,
      tokenHash: sha256Hex(token),
      expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    });

    const acceptUrl = `${(process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/invite/${token}`;
    try {
      const message = inviteEmail({
        businessName: business.name,
        acceptUrl,
        expiresAt: invite.expiresAt,
      });
      const sent = await provider.send({
        to: invite.email,
        ...message,
        idempotencyKey: `invite:${invite.id}`,
      });
      ctx.logger.info(
        { inviteId: invite.id, providerMessageId: sent.providerMessageId },
        'invite email sent',
      );
    } catch (error) {
      ctx.logger.error(
        { inviteId: invite.id, err: { message: (error as Error).message } },
        'invite email failed',
      );
      throw AppError.unavailable('The invitation could not be emailed. Try again.');
    }

    return {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt.toISOString(),
      // Dev convenience only: never in production, never with a real provider.
      ...(process.env.NODE_ENV !== 'production' && isFakeEmail() ? { acceptUrl } : {}),
    };
  },

  /** OWNER only. Pending = not accepted and not expired. Never exposes token material. */
  async listPending(ctx: SessionContext, deps = defaultDeps) {
    requireRole(ctx, 'OWNER');
    const rows = await inviteRepo.listPending(ctx.businessId, deps.now());
    return {
      invites: rows.map((r) => ({
        id: r.id,
        email: r.email,
        role: r.role,
        expiresAt: r.expiresAt.toISOString(),
      })),
    };
  },

  /** Public. Unknown, used and expired tokens are all the same 404. */
  async preview(token: string, deps = defaultDeps) {
    const invite = await inviteRepo.findOpenByTokenHash(sha256Hex(token), deps.now());
    if (!invite) throw notFound();
    return {
      businessName: invite.business.name,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt.toISOString(),
    };
  },

  /**
   * Public, single use. A new email creates the user; an existing user must prove their password and just
   * gains a membership. The conditional update on `acceptedAt IS NULL` makes parallel accepts safe.
   */
  async accept(
    ctx: RouteContext,
    token: string,
    input: { name: string; password: string },
    deps = defaultDeps,
  ): Promise<SignedIn> {
    const now = deps.now();
    const invite = await inviteRepo.findOpenByTokenHash(sha256Hex(token), now);
    if (!invite) throw notFound();

    const existing = await userRepo.findByEmail(invite.email);
    let user: { existingId: string } | { name: string; passwordHash: string };
    if (existing) {
      const wait = deps.throttle.retryAfterSec(invite.email, now);
      if (wait > 0) throw AppError.tooManyAttempts(wait);
      if (!(await verifyPassword(input.password, existing.passwordHash))) {
        deps.throttle.recordFailure(invite.email, now);
        throw AppError.invalidCredentials();
      }
      deps.throttle.clear(invite.email);
      if (await membershipRepo.hasMembership(invite.businessId, existing.id))
        throw AppError.conflict(
          'ALREADY_MEMBER',
          undefined,
          'You already belong to this business.',
        );
      user = { existingId: existing.id };
    } else {
      if (input.password.length < 10)
        throw AppError.validation({ password: 'Use at least 10 characters.' });
      user = { name: input.name, passwordHash: await hashPassword(input.password) };
    }

    const session = sessionService.issue(now);
    try {
      const result = await inviteRepo.accept(invite.businessId, {
        inviteId: invite.id,
        now,
        user,
        sessionTokenHash: session.tokenHash,
        sessionExpiresAt: session.expiresAt,
      });
      ctx.logger.info({ businessId: invite.businessId, userId: result.user.id }, 'invite accepted');
      return {
        info: toSessionInfo(result.user, invite.business, result.role),
        token: session.token,
        expiresAt: session.expiresAt,
      };
    } catch (error) {
      if (error instanceof InviteGoneError) throw notFound();
      if (fromDbError(error)?.code === 'CONFLICT') {
        // New user: the only unique key that can collide is User.email (someone registered it meanwhile),
        // so answer generically. Existing user: the Membership (userId, businessId) pair already exists.
        if ('existingId' in user)
          throw AppError.conflict(
            'ALREADY_MEMBER',
            undefined,
            'You already belong to this business.',
          );
        throw AppError.conflict('CONFLICT');
      }
      throw error;
    }
  },
};
