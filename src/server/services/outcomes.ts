import type { OutcomeTarget } from '@/server/domain/outcomes';
import { requireRole } from '@/server/http/auth';
import { AppError } from '@/server/http/errors';
import type { SessionContext } from '@/server/http/withRoute';
import { outcomeRepo, type OutcomeRow } from '@/server/repositories/outcome.repo';

const MAX_ATTEMPTS = 3;

const toDto = (row: OutcomeRow) => ({
  appointment: {
    id: row.id,
    status: row.status,
    startAt: row.startAt,
    endAt: row.endAt,
    client: row.client,
  },
});

export const outcomesService = {
  /**
   * Record or correct an outcome. The transition and the client counters are decided in the repository
   * transaction (conditional update on the status that was read), so two requests racing each other count
   * once: the loser re-reads and sees a no-op or a conflict.
   */
  async mark(
    ctx: SessionContext,
    id: string,
    outcome: OutcomeTarget,
    now: () => Date = () => new Date(),
  ) {
    requireRole(ctx, 'OWNER', 'STAFF');
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const res = await outcomeRepo.markOutcome(ctx.businessId, id, ctx.userId, outcome, now());
      switch (res.kind) {
        case 'not_found':
          throw AppError.notFound();
        case 'raced':
          continue;
        case 'not_started':
          throw AppError.conflict(
            'NOT_STARTED',
            undefined,
            'This appointment has not started yet.',
          );
        case 'not_ended':
          throw AppError.conflict(
            'NOT_ENDED',
            undefined,
            'This appointment is still in progress; it can be marked attended once it ends.',
          );
        case 'conflict':
          throw AppError.conflict(
            'CONFLICT',
            undefined,
            'This appointment cannot be marked with that outcome.',
          );
        case 'applied':
          if (res.drift)
            ctx.logger.warn(
              { businessId: ctx.businessId, appointmentId: id },
              'client counter drift: a correction found its counter already at 0',
            );
          ctx.logger.info(
            { businessId: ctx.businessId, appointmentId: id, outcome, userId: ctx.userId },
            'appointment outcome recorded',
          );
          return toDto(res.row);
        case 'noop':
          return toDto(res.row);
      }
    }
    throw AppError.conflict('CONFLICT', undefined, 'The appointment changed; try again.');
  },

  async queue(ctx: SessionContext, limit: number, now: () => Date = () => new Date()) {
    requireRole(ctx, 'OWNER', 'STAFF');
    const at = now();
    const [items, count] = await Promise.all([
      outcomeRepo.listQueue(ctx.businessId, at, limit),
      outcomeRepo.countQueue(ctx.businessId, at),
    ]);
    return { count, items };
  },
};
