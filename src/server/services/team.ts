import { checkRemoval } from '@/server/domain/teamAccess';
import { requireRole } from '@/server/http/auth';
import { AppError } from '@/server/http/errors';
import type { SessionContext } from '@/server/http/withRoute';
import { inviteRepo } from '@/server/repositories/invite.repo';
import { ActorGoneError, MemberNotFoundError, membershipRepo } from '@/server/repositories/membership.repo';

const defaultDeps = { now: () => new Date() };

export const teamService = {
  /** OWNER only. Members (no secrets) and pending invites, newest invite first. */
  async list(ctx: SessionContext, deps = defaultDeps) {
    requireRole(ctx, 'OWNER');
    const [members, invites] = await Promise.all([
      membershipRepo.listTeam(ctx.businessId),
      inviteRepo.listPendingNewestFirst(ctx.businessId, deps.now()),
    ]);
    return {
      members: members.map((m) => ({ ...m, isYou: m.userId === ctx.userId })),
      invites: invites.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        expiresAt: i.expiresAt.toISOString(),
        createdAt: i.createdAt.toISOString(),
      })),
    };
  },

  /**
   * OWNER only. Takes a person's login away (L3): membership + that user's sessions for this business go in
   * one transaction. Not yourself, never the last owner; another business or an already removed member is 404.
   */
  async removeMember(
    ctx: SessionContext,
    userId: string,
    deps = defaultDeps,
  ): Promise<{ ok: true; futureAppointments: number }> {
    requireRole(ctx, 'OWNER');
    let result: { futureAppointments: number };
    try {
      result = await membershipRepo.removeMember(ctx.businessId, ctx.userId, userId, deps.now(), ({ role, ownerCount }) => {
        const verdict = checkRemoval({
          actorUserId: ctx.userId,
          targetUserId: userId,
          targetRole: role,
          ownerCount,
        });
        if (verdict === 'SELF')
          throw AppError.conflict(
            'CANNOT_REMOVE_SELF',
            undefined,
            'You cannot remove your own access.',
          );
        if (verdict === 'LAST_OWNER')
          throw AppError.conflict(
            'LAST_OWNER',
            undefined,
            'A business must keep at least one owner.',
          );
      });
    } catch (error) {
      if (error instanceof MemberNotFoundError) throw AppError.notFound();
      // The caller was removed while this request was in flight: same answer as a dead session.
      if (error instanceof ActorGoneError) throw AppError.unauthenticated();
      throw error;
    }
    ctx.logger.info(
      { removedUserId: userId, futureAppointments: result.futureAppointments },
      'team member access removed',
    );
    return { ok: true, futureAppointments: result.futureAppointments };
  },

  /** OWNER only. Deletes an unaccepted invite so its link dies at once. Unknown/other business/accepted: 404. */
  async revokeInvite(ctx: SessionContext, inviteId: string): Promise<{ ok: true }> {
    requireRole(ctx, 'OWNER');
    if (!(await inviteRepo.revoke(ctx.businessId, inviteId))) throw AppError.notFound();
    ctx.logger.info({ inviteId }, 'invite revoked');
    return { ok: true };
  },
};
