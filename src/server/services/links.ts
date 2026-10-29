import {
  cancelCutoffAt,
  cancelOutcomeFor,
  confirmOutcomeFor,
  linkActionAllowed,
  type LinkAction,
} from '@/server/domain/linkPolicy';
import type { TokenAction } from '@/server/domain/tokens';
import { AppError } from '@/server/http/errors';
import type { Logger } from '@/server/http/logger';
import { appointmentRepo } from '@/server/repositories/appointment.repo';
import { onSlotFreed } from './slotFreed';

export interface LinkCtx {
  businessId: string;
  logger: Logger;
}
export interface LinkIdentity {
  subjectId: string;
  action: TokenAction;
}

export type LinkResult =
  'confirmed' | 'cancelled' | 'late_cancelled' | 'already_confirmed' | 'already_cancelled';

type Row = NonNullable<Awaited<ReturnType<typeof appointmentRepo.findForLink>>>;

const CANCELLABLE = ['BOOKED', 'CONFIRMED', 'PENDING_PAYMENT'];

function view(a: Row, now: Date, act: TokenAction) {
  const cutoff = cancelCutoffAt(a.startAt, a.business.cancelCutoffMin);
  return {
    act,
    appointment: {
      id: a.id,
      startAt: a.startAt,
      endAt: a.endAt,
      status: a.status,
      service: {
        id: a.service.id,
        name: a.service.name,
        durationMin: a.service.durationMin,
        price: Number(a.service.price.toString()),
      },
      staff: a.staff,
    },
    business: {
      name: a.business.name,
      slug: a.business.slug,
      timezone: a.business.timezone,
      locale: a.business.locale,
    },
    canConfirm: a.status === 'BOOKED',
    canCancel: CANCELLABLE.includes(a.status),
    cancelCutoffAt: cutoff,
    pastCutoff: now.getTime() >= cutoff.getTime(),
    confirmedAt: a.confirmedAt,
  };
}

async function load(ctx: LinkCtx, id: string): Promise<Row> {
  const row = await appointmentRepo.findForLink(ctx.businessId, id);
  if (!row) throw AppError.notFound();
  return row;
}

export const linksService = {
  /** No side effects: email scanners open these URLs. */
  async get(ctx: LinkCtx, token: LinkIdentity, now: () => Date = () => new Date()) {
    return view(await load(ctx, token.subjectId), now(), token.action);
  },

  async act(
    ctx: LinkCtx,
    token: LinkIdentity,
    action: LinkAction,
    now: () => Date = () => new Date(),
  ) {
    if (!linkActionAllowed(token.action, action))
      throw new AppError(403, 'WRONG_LINK_ACTION', 'This link cannot do that.');
    const at = now();
    const id = token.subjectId;
    let current = await load(ctx, id);
    let result: LinkResult;

    if (action === 'confirm') {
      const outcome = confirmOutcomeFor(current.status);
      if (outcome === 'conflict')
        throw AppError.conflict(
          'CONFLICT',
          undefined,
          'This appointment can no longer be confirmed.',
        );
      if (outcome === 'already_confirmed') result = 'already_confirmed';
      else if (await appointmentRepo.confirmByLink(ctx.businessId, id, at)) {
        result = 'confirmed';
        ctx.logger.info(
          { businessId: ctx.businessId, appointmentId: id },
          'appointment confirmed by link',
        );
      } else {
        // Lost a race: report whatever state won.
        current = await load(ctx, id);
        if (current.status === 'CONFIRMED') result = 'already_confirmed';
        else
          throw AppError.conflict(
            'CONFLICT',
            undefined,
            'This appointment can no longer be confirmed.',
          );
      }
    } else {
      const cutoffMin = current.business.cancelCutoffMin;
      const outcome = cancelOutcomeFor(current.status, at, current.startAt, cutoffMin);
      if (outcome === 'conflict')
        throw AppError.conflict(
          'CONFLICT',
          undefined,
          'This appointment can no longer be cancelled.',
        );
      if (outcome === 'already_cancelled') result = 'already_cancelled';
      else {
        const late = outcome === 'late_cancel';
        if (await appointmentRepo.cancelByLink(ctx.businessId, id, at, late)) {
          result = late ? 'late_cancelled' : 'cancelled';
          ctx.logger.info(
            { businessId: ctx.businessId, appointmentId: id, late },
            'appointment cancelled by link',
          );
          await onSlotFreed(ctx, {
            appointmentId: id,
            serviceId: current.service.id,
            staffId: current.staff.id,
            startAt: current.startAt,
            endAt: current.endAt,
          });
        } else {
          current = await load(ctx, id);
          if (current.status === 'CANCELLED' || current.status === 'LATE_CANCEL')
            result = 'already_cancelled';
          else
            throw AppError.conflict(
              'CONFLICT',
              undefined,
              'This appointment can no longer be cancelled.',
            );
        }
      }
    }
    return { ...view(await load(ctx, id), at, token.action), result };
  },
};
